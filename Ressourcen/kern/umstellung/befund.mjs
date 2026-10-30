// umstellung/befund.mjs — Befund für Vaults aus der Kit-Zeit (Paket P7a, Plan docs/plaene/p7-umstellung.md). NUR LESEN.
//
// Findet alle Altlasten eines Vaults, der noch auf den alten Kit-Ordner im Vault (ALT_KIT_ORDNER) zeigt, und stuft jede ein:
//   auto     Kortex stellt es später selbst um (Phase A/B der Umstellung)
//   frage    braucht eine Entscheidung des Nutzers
//   hinweis  Kortex ändert es nicht (fremde Programme, Dateien des Nutzers) – nur zur Info
//   blocker  muss vorher gelöst werden (sonst schreibt Kortex an eine falsche Stelle) – `blockiertPhase` sagt, welche Phase
// Der Befund schreibt nichts (kein Index, keine Sperre, kein Merker), startet kein Programm aus dem Vault und ruft weder `claude`/`codex` noch `launchctl`
// auf. Er enthält nur Kategorien, Zählungen, Stellen-Namen und Schlüssel*namen* – nie den Wert eines git-Schlüssels, eines Hook-Befehls, eines MCP-Eintrags
// oder einer Umgebungsvariable. Ein Fund hat:
//   { id, kategorie, schwere, ort, anzahl, aktion, phase, blockiertPhase?, profil?, details?, text }
// `text` ist der Satz für Nicht-Techniker (Begriffe: App „Kortex“, Datenordner „Vault“).
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { homedir, tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { ALT_KIT_ORDNER, kernVersion, liesConfigRoh, istOrdnerName, pruefeVault, supportOrdner } from "../pfade.mjs";
import { pruefeBackupPfad, merkerDateiFuer } from "../backup.mjs";
import { echtesGit, gitLesen, lokaleKonfiguration, werte, pruefungAlle, ordneSchluesselEin, zaehleFormen, formSchluessel, adressArt, lokaleRemotes, hooksPfadArt, gitVerzeichnis } from "./git-lage.mjs";
import { pruefeEinstellungen, pruefeBekannteMaerkte, pruefeBefehleUndSkills, pruefeShellDateien, zeilenMitVerweis, nennt } from "./restverweise.mjs";
import { mcpLage } from "./mcp-lage.mjs";
import { findeVerwaiste } from "./verwaist.mjs";
import { erkenneProfile, profileAusPfaden } from "./profile.mjs";

export const BEFUND_VERSION = 1;
const ALTE_FELDER = ["werkzeuge", "kit", "systemVersion", "updateHinweis", "vaultPath"];
const ORDNER_SCHLUESSEL = [["ordner", "inbox"], ["ordner", "wiki"], ["ordner", "archiv"], ["wiki", "ordner"]];
const DIENST_LABEL = "de.brain.tageslauf";

const maskiere = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const echt = (p) => { try { return realpathSync(p); } catch { return resolve(p); } };
const falte = (s) => String(s).normalize("NFC").toLowerCase();
const istObjekt = (x) => x && typeof x === "object" && !Array.isArray(x);
const unxml = (s) => String(s).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const mehrzahl = (n, eins, viele) => (n === 1 ? eins : viele);
// <Support>/backup/<Kennung>.json (Sicherungsordner „pfad“, bestätigtes Online-Ziel „remoteBestaetigt“) – fehlt die Datei, ist es {}
function leseMerker(support, vault) {
  try { const o = JSON.parse(readFileSync(merkerDateiFuer(vault, support), "utf8")); return istObjekt(o) ? o : {}; } catch { return {}; }
}

// Versionsvergleich „0.5.1“ < „1.0.0“ (Zahlenteile; unbekannt = 0)
function versionKleiner(a, b) {
  const z = (v) => String(v || "").split(/[.+-]/).map((x) => (/^\d+$/.test(x) ? Number(x) : 0));
  const x = z(a), y = z(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0); }
  return false;
}

function bekannteVaults(support, vault) {
  const liste = [vault];
  try {
    const j = JSON.parse(readFileSync(join(support, "vaults.json"), "utf8"));
    for (const e of Array.isArray(j?.vaults) ? j.vaults : []) if (e && typeof e.pfad === "string") liste.push(e.pfad);
  } catch { /* keine Liste */ }
  return liste;
}

function ordnerGroesse(wurzel, grenze = 20_000) {
  let dateien = 0, bytes = 0, abgeschnitten = false;
  const lauf = (dir) => {
    let namen;
    try { namen = readdirSync(dir); } catch { return; }
    for (const n of namen) {
      if (dateien >= grenze) { abgeschnitten = true; return; }
      const p = join(dir, n);
      let s;
      try { s = lstatSync(p); } catch { continue; }
      if (s.isSymbolicLink()) continue;
      if (s.isDirectory()) { if (n !== ".git" && n !== "node_modules") lauf(p); else if (n === "node_modules") { dateien++; } continue; }
      dateien++; bytes += s.size;
    }
  };
  lauf(wurzel);
  return { dateien, bytes, abgeschnitten };
}

function laufendeProzesse(vault) {
  const orte = [...new Set([resolve(vault), echt(vault)])].map((v) => `${maskiere(v)}/${maskiere(ALT_KIT_ORDNER)}/`);
  try {
    const aus = execFileSync("/usr/bin/pgrep", ["-f", "--", orte.join("|")], { encoding: "utf8", timeout: 10_000, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    return aus.split("\n").filter((z) => /^\d+$/.test(z.trim())).filter((z) => Number(z) !== process.pid).length;
  } catch { return 0; }   // Exit 1 = keine Treffer; fehlt pgrep, gilt „keine bekannt“
}

function leseConfigRoh(vault) {
  const datei = join(vault, "brain.config.json");
  let buf = null;
  try { buf = readFileSync(datei); } catch { /* fehlt */ }
  const roh = liesConfigRoh(vault);
  return { ...roh, bom: !!buf && buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf };
}

// ------------------------------------------------------------------------------------------------------------------------------
export function erstelleBefund({ vault, home = homedir(), env = process.env, support = supportOrdner({ home, env }), claudeHomes = null, git = undefined, plattform = process.platform, tmp = tmpdir() } = {}) {
  vault = resolve(vault);
  const funde = [];
  const f = (id, kategorie, schwere, ort, anzahl, aktion, text, extra = {}) => funde.push({ id, kategorie, schwere, ort, anzahl, aktion, phase: "A", ...extra, text });
  const versuche = (fn) => { try { fn(); } catch (e) { if (env.BRAIN_BEFUND_DEBUG) console.error(e); } };

  // --- 0. Ist das ein Vault, den der Kern überhaupt beschreiben würde? (E8) -------------------------------------------------
  let vaultOk = true;
  try { pruefeVault(vault); } catch (e) {
    vaultOk = false;
    const verweis = /^Kein sicherer Vault/.test(String(e?.message));
    if (verweis) f("E8", "vault-verweis", "blocker", "Vault", 1, "verweis-beheben", "Im Vault zeigt eine Verknüpfung (Symlink) aus dem Ordner hinaus, zum Beispiel beim Protokoll-, Inbox-, Wiki- oder Archivordner. Kortex schreibt dort aus Sicherheitsgründen nichts hinein. Löse die Verknüpfung auf, dann geht es weiter.");
    else f("E0", "vault-ungueltig", "blocker", "Vault", 1, "vault-waehlen", "Dieser Ordner ist kein Vault (es fehlt der Ordner oder die Datei brain.config.json). Wähle in Kortex einen anderen Vault.");
  }
  if (vaultOk || existsSync(vault)) {
    // --- 1. Kit-Ordner im Vault (E1–E3) ----------------------------------------------------------------------------------
    const kitPfad = join(vault, ALT_KIT_ORDNER);
    let kit = null;
    versuche(() => {
      let l;
      try { l = lstatSync(kitPfad); } catch { return; }
      kit = { art: l.isSymbolicLink() ? "verweis" : l.isDirectory() ? "ordner" : "datei", version: null, dateien: 0, bytes: 0, abgeschnitten: false };
      if (kit.art === "ordner") {
        try { const v = readFileSync(join(kitPfad, "VERSION"), "utf8").trim(); if (/^[0-9][0-9A-Za-z.+-]{0,30}$/.test(v)) kit.version = v; } catch { /* keine VERSION */ }
        Object.assign(kit, ordnerGroesse(kitPfad));
      }
    });
    if (kit) {
      const art = kit.art === "verweis" ? " (eine Verknüpfung auf einen anderen Ort)" : "";
      f("E1", "kit-ordner", "auto", "Vault", 1, "kit-archivieren", `Im Vault liegt noch der alte Werkzeug-Ordner${kit.version ? ` (Version ${kit.version})` : ""}${art}. Kortex benutzt ihn nicht mehr; er wird bei einem späteren Update aufgeräumt, vorher archiviert und nichts geht verloren.`,
        { phase: "B", details: { art: kit.art, version: kit.version, dateien: kit.dateien, bytes: kit.bytes, abgeschnitten: kit.abgeschnitten } });
      const prozesse = laufendeProzesse(vault);
      if (prozesse > 0) f("E3", "kit-prozesse", "blocker", "Vault", prozesse, "sitzungen-beenden", `Es laufen noch ${prozesse} ${mehrzahl(prozesse, "Programm", "Programme")} aus dem alten Werkzeug-Ordner (zum Beispiel in einer offenen Claude-Sitzung). Beende offene Claude-Sitzungen, bevor aufgeräumt wird.`, { phase: "B", blockiertPhase: "B" });
    }

    // --- 2. Einstellungen des Vaults (E4–E7) -------------------------------------------------------------------------------
    const roh = leseConfigRoh(vault);
    const cfg = roh.cfg && istObjekt(roh.cfg) ? roh.cfg : null;
    if (roh.fehler) f("E4", "config-defekt", "blocker", "Vault", 1, "config-reparieren", "Die Einstellungsdatei des Vaults (brain.config.json) ist beschädigt und lässt sich nicht lesen. Kortex arbeitet so mit Standardwerten. Bitte repariere die Datei oder stelle sie aus der Sicherung wieder her.");
    else if (roh.bom) f("E4", "config-bom", "auto", "Vault", 1, "config-bereinigen", "Die Einstellungsdatei des Vaults beginnt mit einem unsichtbaren Sonderzeichen. Das ist harmlos; Kortex entfernt es beim späteren Aufräumen.", { phase: "B" });
    if (cfg) {
      const bp = istObjekt(cfg.backup) ? cfg.backup.pfad : undefined;
      if (typeof bp === "string" && bp) {
        const merker = leseMerker(support, vault);
        const ungueltig = pruefeBackupPfad(bp) !== null;
        if (ungueltig) f("E5", "sicherungsordner-ungueltig", "frage", "Vault", 1, "sicherungsordner-pruefen", "In den Einstellungen des Vaults steht ein Sicherungsordner, den Kortex nicht übernehmen kann (er ist kein absoluter Pfad, kein Ordner oder eine Verknüpfung). Du kannst in Kortex einen neuen Sicherungsordner wählen.");
        else if (typeof merker.pfad === "string" && merker.pfad && merker.pfad !== bp) f("E5", "sicherungsordner-abweichend", "frage", "Vault", 1, "sicherungsordner-waehlen", "Für die Sicherung ist in Kortex schon ein anderer Ordner eingestellt als der in den alten Einstellungen des Vaults. Du entscheidest, welcher gelten soll.");
        else if (merker.pfad === bp) f("E5", "sicherungsordner-uebernommen", "auto", "Vault", 1, "config-bereinigen", "Dein Sicherungsordner ist schon in Kortex übernommen; der alte Eintrag in den Einstellungen des Vaults wird beim späteren Aufräumen entfernt.", { phase: "B" });
        else f("E5", "sicherungsordner", "auto", "Vault", 1, "sicherungsordner-uebernehmen", "Dein Sicherungsordner wird übernommen: Kortex merkt ihn sich künftig auf diesem Mac statt in den Einstellungen des Vaults.");
      }
      const alt = ALTE_FELDER.filter((k) => k in cfg);
      if (alt.length) f("E6", "config-altfelder", "auto", "Vault", alt.length, "config-bereinigen", `In den Einstellungen des Vaults stehen ${alt.length} ${mehrzahl(alt.length, "altes Feld", "alte Felder")} (${alt.join(", ")}), die Kortex nicht mehr liest. Sie sind schon jetzt wirkungslos und werden beim späteren Aufräumen entfernt.`, { phase: "B", details: { felder: alt } });
      const schlecht = ORDNER_SCHLUESSEL.filter(([a, b]) => istObjekt(cfg[a]) && cfg[a][b] !== undefined && !istOrdnerName(cfg[a][b])).map(([a, b]) => `${a}.${b}`);
      if (schlecht.length) f("E7", "ordnername-ungueltig", "blocker", "Vault", schlecht.length, "ordnername-beheben", `In den Einstellungen des Vaults ${mehrzahl(schlecht.length, "ist ein Ordner", "sind Ordner")} als Pfad statt als einfacher Name angegeben (${schlecht.join(", ")}). Kortex kennt nur einfache Ordnernamen und würde sonst einen neuen, leeren Standardordner anlegen. Trage dort nur den Namen des Ordners ein.`, { details: { schluessel: schlecht } });
    }

    // --- 3. Versionsverlauf (E2, E9–E13, E23, E25) -------------------------------------------------------------------------------
    const gitProg = git === undefined ? echtesGit(env) : git;
    const gv = gitVerzeichnis(vault);
    let konfig = null, pruefung = { ok: true, namen: [], nichtPruefbar: false };
    if (gv.art !== "keins") {
      if (gv.art === "verweis" || gv.draussen) f("E12", "git-ausserhalb", "blocker", "Versionsverlauf des Vaults", 1, "git-neu-einrichten", "Der Versionsverlauf dieses Vaults liegt außerhalb des Vault-Ordners (oder ist nur eine Verknüpfung dorthin). Kortex nutzt ihn aus Sicherheitsgründen nicht. Hole den Vault frisch aus der Online-Sicherung oder richte ihn neu ein.");
      if (gv.alternates) f("E12", "git-alternates", "blocker", "Versionsverlauf des Vaults", 1, "git-neu-einrichten", "Der Versionsverlauf dieses Vaults verweist auf fremde Objektspeicher (alternates). Kortex nutzt ihn so nicht. Hole den Vault frisch aus der Online-Sicherung oder löse die Verbindung auf.");
      if (gv.verweise.length) f("E12", "git-verweise", "frage", "Versionsverlauf des Vaults", gv.verweise.length, "git-verweise-aufloesen", `Im Versionsverlauf des Vaults ${mehrzahl(gv.verweise.length, "liegt eine Verknüpfung", "liegen " + gv.verweise.length + " Verknüpfungen")} (Symlinks). Damit schriebe der Versionsverlauf nach draußen, deshalb sperrt Kortex ihn. Kortex kann die Verknüpfung durch eine echte Kopie ersetzen.`, { details: { stellen: gv.verweise.slice(0, 10) } });
      if (gv.eigeneHooks > 0) f("E13", "git-hooks-eigen", "hinweis", "Versionsverlauf des Vaults", gv.eigeneHooks, "info", `Im Versionsverlauf des Vaults ${mehrzahl(gv.eigeneHooks, "liegt ein eigenes Programm", "liegen " + gv.eigeneHooks + " eigene Programme")} (Hooks). Kortex führt sie nie aus; die Passwort-Prüfung vor dem Speichern bringt Kortex selbst mit.`);
      if (!gv.draussen && gv.art !== "verweis") {
        konfig = lokaleKonfiguration(gitProg, vault, { home });
        pruefung = pruefungAlle(gitProg, vault, { home });
      }
    }
    if (konfig) {
      // core.hooksPath (E9)
      const hp = werte(konfig, "core.hooksPath").pop();
      if (hp) {
        const h = hooksPfadArt(hp, vault, ALT_KIT_ORDNER, support);
        if (h.art === "kit-alt") f("E9", "hookspfad-alt", "auto", "Versionsverlauf des Vaults", 1, "hooks-umstellen", "Die Passwort-Prüfung vor dem Speichern zeigt noch auf den alten Werkzeug-Ordner. Kortex stellt sie auf seine eigene Prüfung um.", { details: { form: h.form } });
        else if (h.art === "fremd") f("E9", "hookspfad-fremd", "frage", "Versionsverlauf des Vaults", 1, "hooks-ersetzen-fragen", "Im Versionsverlauf ist schon eine andere Prüfung vor dem Speichern eingetragen, zum Beispiel von einem anderen Programm. Kortex lässt sie unverändert, solange du nicht ausdrücklich „Ersetzen“ wählst.");
      }
      // Remote-Adressen (E11, E25, E26)
      const lokal = lokaleRemotes(konfig);
      if (lokal.length) f("E11", "remote-lokal", "frage", "Versionsverlauf des Vaults", lokal.length, "remote-entfernen", `Der Versionsverlauf sichert an ${mehrzahl(lokal.length, "einen Ordner", lokal.length + " Ordner")} auf diesem Mac (ein lokales Ziel). Das sperrt Kortex aus Sicherheitsgründen. Du kannst das Ziel entfernen und stattdessen eine Ordner-Sicherung einrichten.`);
      const origin = werte(konfig, "remote.origin.url").pop() ?? null;
      const art = adressArt(origin);
      if (origin !== null && (art === "https" || art === "ssh")) {
        const merker = leseMerker(support, vault);
        if (merker.remoteBestaetigt !== origin) f("E25", "sicherung-ziel", "frage", "Online-Sicherung", 1, "sicherung-bestaetigen", `Die Online-Sicherung geht an ein Ziel (${art === "https" ? "per https" : "per ssh"}), das du in Kortex noch nicht bestätigt hast. Ein Vault kann ein fremdes Ziel mitbringen, deshalb sichert Kortex erst nach deiner Bestätigung.`, { details: { adresse: art, sicherungsart: istObjekt(cfg?.backup) && typeof cfg.backup.art === "string" ? cfg.backup.art : null } });
      }
      if (origin !== null) f("E26", "weitere-macs", "frage", "Vault", 1, "weitere-macs-fragen", "Nutzt du diesen Vault auch auf einem anderen Mac? Dann stellt Kortex auf jedem Mac einzeln um, und das Aufräumen kommt erst, wenn alle Macs umgestellt sind.", { details: { origin: art } });
    }
    // Alle verbotenen Schlüssel (E10)
    if (pruefung.nichtPruefbar && gv.art !== "keins" && !gv.draussen) {
      f("E10", "git-pruefung-unmoeglich", "hinweis", "Versionsverlauf des Vaults", 1, "info", "Die Einstellungen des Versionsverlaufs konnten nicht geprüft werden (git oder die Prüfung fehlt auf diesem Mac).");
    } else if (pruefung.namen.length) {
      const lokaleNamen = new Set(konfig ? lokaleRemotes(konfig) : []);
      const rest = pruefung.namen.filter((n) => !lokaleNamen.has(n));
      const einteilung = ordneSchluesselEin(rest.map(formSchluessel));
      const verschiebbar = rest.filter((n) => einteilung.verschiebbar.includes(formSchluessel(n)));
      const form = (liste) => [...zaehleFormen(liste)].map(([k, n]) => (n > 1 ? `${k} (${n}×)` : k));
      if (verschiebbar.length) {
        const namen = [...new Set(verschiebbar.map(formSchluessel))];
        f("E10", "git-schluessel", "frage", "Versionsverlauf des Vaults", verschiebbar.length, "git-schluessel-verschieben", `Im Versionsverlauf dieses Vaults ${mehrzahl(verschiebbar.length, "ist eine persönliche Einstellung", "sind " + verschiebbar.length + " persönliche Einstellungen")} eingetragen, die Kortex aus Sicherheitsgründen sperrt (${namen.join(", ")}). Kortex kann ${mehrzahl(verschiebbar.length, "sie", "sie")} in deine persönlichen Einstellungen verschieben – sie gelten dann weiter nur für diesen Vault.`, { details: { schluessel: form(verschiebbar) } });
      }
      const struktur = rest.filter((n) => einteilung.strukturell.includes(formSchluessel(n))), wert = rest.filter((n) => einteilung.repoWert.includes(formSchluessel(n)));
      if (struktur.length) f("E10", "git-struktur", "hinweis", "Versionsverlauf des Vaults", struktur.length, "info", `Der Versionsverlauf dieses Vaults hat ${mehrzahl(struktur.length, "eine Einstellung", struktur.length + " Einstellungen")}, die zu seinem Aufbau gehören oder nur als allgemeine Einstellung des Nutzers wirken (Einbindungen, Sicherheitsfreigaben) (${[...new Set(struktur.map(formSchluessel))].join(", ")}). Kortex kann sie nicht verschieben: Der Vault arbeitet in Kortex ohne Versionsverlauf, bis er anders eingerichtet ist, zum Beispiel frisch aus der Online-Sicherung.`, { details: { schluessel: form(struktur) } });
      if (wert.length) f("E10", "git-wert-ungueltig", "hinweis", "Versionsverlauf des Vaults", wert.length, "info", `Im Versionsverlauf dieses Vaults ${mehrzahl(wert.length, "hat eine Einstellung", wert.length + " Einstellungen haben")} einen Wert, den Kortex nicht akzeptiert (${[...new Set(wert.map(formSchluessel))].join(", ")}). Bitte korrigiere ${mehrzahl(wert.length, "sie", "sie")} von Hand.`, { details: { schluessel: form(wert) } });
    }
    // Kit-Ordner im Versionsverlauf (E2) und AGENTS.md (E23) – nur Unterbefehle, die keinen Treiber starten
    if (gitProg && gv.art !== "keins" && !gv.draussen && gv.art !== "verweis" && konfig) {
      if (kit && kit.art === "ordner") versuche(() => {
        const aus = gitLesen(gitProg, vault, ["ls-files", "-z", "--", ALT_KIT_ORDNER], { home });
        const versioniert = aus === null ? null : aus.split("\0").filter(Boolean).length;
        let geaendert = null, unversioniert = null;
        if (pruefung.ok && !pruefung.nichtPruefbar && versioniert !== null) {
          const st = gitLesen(gitProg, vault, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", ALT_KIT_ORDNER], { home });
          if (st !== null) {
            const eintraege = st.split("\0").filter(Boolean);
            unversioniert = eintraege.filter((e) => e.startsWith("??")).length;
            geaendert = eintraege.length - unversioniert;
          }
        }
        if (versioniert === null) return;
        const offen = (geaendert || 0) + (unversioniert || 0);
        const details = { versioniert, geaendert, unversioniert };
        if (versioniert === 0) f("E2", "kit-unversioniert", "hinweis", "Vault", kit.dateien, "info", "Der alte Werkzeug-Ordner steht nicht im Versionsverlauf, er liegt nur auf diesem Mac. Beim späteren Aufräumen legt Kortex ihn zuerst in ein Archiv; es geht nichts verloren.", { phase: "B", details });
        else if (offen > 0) f("E2", "kit-ungesichert", "frage", "Vault", offen, "kit-archivieren", `Im alten Werkzeug-Ordner ${mehrzahl(offen, "liegt eine Datei", "liegen " + offen + " Dateien")} mit Änderungen, die noch nicht im Versionsverlauf gesichert ${mehrzahl(offen, "ist", "sind")}. Beim späteren Aufräumen legt Kortex den ganzen Ordner zuerst in ein Archiv; es geht nichts verloren. Schau vorher nach, ob du Eigenes behalten willst.`, { phase: "B", details });
        else if (versioniert > 0) f("E2", "kit-versioniert", "hinweis", "Versionsverlauf des Vaults", versioniert, "info", `Der alte Werkzeug-Ordner ist im Versionsverlauf des Vaults gespeichert (${versioniert} ${mehrzahl(versioniert, "Datei", "Dateien")}). Beim späteren Aufräumen nimmt Kortex ihn aus dem Versionsverlauf; im Verlauf bleibt er nachlesbar.`, { phase: "B", details });
      });
      versuche(() => {
        const a = gitLesen(gitProg, vault, ["ls-files", "-z", "--", "AGENTS.md"], { home });
        if (a && a.split("\0").filter(Boolean).length) f("E23", "agents-versioniert", "frage", "Vault", 1, "agents-aus-verlauf", "Die Datei AGENTS.md ist im Versionsverlauf gespeichert. Kortex schreibt sie auf jedem Mac mit den dortigen Pfaden neu – das würde ständig neue Änderungen erzeugen. Kortex kann sie aus dem Versionsverlauf nehmen (sie bleibt im Vault liegen).");
      });
    }

    // --- 4. Claude Code (E14–E18) -------------------------------------------------------------------------------------------------
    const profile = claudeHomes && claudeHomes.length ? profileAusPfaden(claudeHomes, home) : erkenneProfile(home);
    for (const p of profile) versuche(() => {
      const ort = `Claude-Profil ${p.name}`;
      const s = pruefeEinstellungen(join(p.pfad, "settings.json"), vault, home);
      if (s.defekt) f("E14", "claude-einstellungen-defekt", "frage", ort, 1, "profil-auslassen", `Die Einstellungsdatei von Claude Code im Profil ${p.name} ist beschädigt (kein gültiges JSON). Kortex ändert sie deshalb nicht. Repariere die Datei oder wähle dieses Profil bei der Umstellung ab.`, { profil: p.pfad });
      if (s.eigeneAlt > 0) f("E14", "claude-hooks", "auto", ort, s.eigeneAlt, "claude-hooks-umstellen", `Claude Code ruft Kortex noch über den alten Werkzeug-Ordner auf (${s.eigeneAlt} ${mehrzahl(s.eigeneAlt, "Stelle", "Stellen")}, Profil ${p.name}). Kortex stellt das auf den neuen Aufruf um; Hooks anderer Programme bleiben unberührt.`, { profil: p.pfad, details: { statuszeile: s.statuszeile, einstellungsdateiIstVerweis: s.verweis } });
      const rest = Object.values(s.rest).reduce((a, b) => a + b, 0);
      if (rest > 0) f("E15", "claude-restverweise", "hinweis", ort, rest, "info", `In den Claude-Einstellungen (Profil ${p.name}) ${mehrzahl(rest, "steht noch eine Stelle", "stehen noch " + rest + " Stellen")}, die auf den alten Werkzeug-Ordner zeigen und nicht zu Kortex gehören (zum Beispiel ein eigenes Skript). Kortex ändert sie nicht. Sie funktionieren nach dem späteren Aufräumen nicht mehr und sollten vorher angepasst werden.`, { profil: p.pfad, details: { stellen: s.rest } });
      const maerkte = s.plugins + pruefeBekannteMaerkte(p.pfad);
      if (maerkte > 0) f("E16", "claude-plugin", "hinweis", ort, maerkte, "info", `Ein Zusatz-Plugin von Claude Code (Profil ${p.name}) wird aus dem alten Werkzeug-Ordner geladen und funktioniert nach dem späteren Aufräumen nicht mehr. Kortex ändert es nicht.`, { profil: p.pfad });
      const c = pruefeBefehleUndSkills(p.pfad);
      if (c.mitMarke > 0) f("E17", "claude-befehle", "auto", ort, c.mitMarke, "claude-hooks-umstellen", `${c.mitMarke} ${mehrzahl(c.mitMarke, "Kortex-Befehl", "Kortex-Befehle")} in Claude Code (Profil ${p.name}) ${mehrzahl(c.mitMarke, "nennt", "nennen")} noch den alten Werkzeug-Ordner. Kortex erzeugt sie beim Umstellen neu.`, { profil: p.pfad });
      const eigene = c.ohneMarke + c.skills;
      if (eigene > 0) f("E17", "claude-befehle-eigen", "hinweis", ort, eigene, "info", `${eigene} eigene ${mehrzahl(eigene, "Befehl oder Skill", "Befehle oder Skills")} in Claude Code (Profil ${p.name}) ${mehrzahl(eigene, "nennt", "nennen")} den alten Werkzeug-Ordner. Kortex ändert eigene Dateien nicht.`, { profil: p.pfad, details: { befehle: c.ohneMarke, skills: c.skills } });
      const z = zeilenMitVerweis(join(p.pfad, "CLAUDE.md"));
      if (z > 0) f("E18", "claude-anweisung", "hinweis", ort, z, "info", `In deiner Anweisungsdatei für Claude (CLAUDE.md, Profil ${p.name}) ${mehrzahl(z, "steht noch ein Befehl", "stehen noch " + z + " Befehle")} aus dem alten Werkzeug-Ordner. Kortex ändert deine Anweisungen nicht. Ersatz: Rufe Kortex über seinen Starter auf (im Support-Ordner von Kortex unter bin/kortex, zum Beispiel „kortex search …“).`, { profil: p.pfad });
    });

    // --- 5. MCP-Einträge (E19) ------------------------------------------------------------------------------------------------------
    versuche(() => {
      for (const e of mcpLage({ home, support, profile, vaults: bekannteVaults(support, vault) })) {
        const ort = e.ziel === "claude" ? `Claude Code, Profil ${e.profilName}` : e.ziel === "codex" ? "Codex" : "Cursor";
        const name = e.ziel === "claude" ? `Claude Code (Profil ${e.profilName})` : e.ziel === "codex" ? "Codex" : "Cursor";
        const extra = { ...(e.profil ? { profil: e.profil } : {}), details: { ziel: e.ziel, art: e.art } };
        if (e.art === "alt") f("E19", "mcp-alt", "auto", ort, 1, "mcp-umstellen", `${name} startet den Kortex-Server für die Suche noch in alter Form. Kortex stellt den Eintrag auf den festen Pfad der App um.`, extra);
        else if (e.art === "anders") f("E19", "mcp-anders", "frage", ort, 1, "mcp-umstellen-fragen", `Bei ${name} ist unter dem Namen „brain“ ein anderer Server eingetragen als der von Kortex. Möchtest du ihn auf Kortex umstellen? Der bisherige Eintrag wird vorher gesichert.`, extra);
        if (e.fremd > 0) f("E19", "mcp-anderer-name", "hinweis", ort, e.fremd, "info", `${name} hat ${mehrzahl(e.fremd, "einen weiteren Server-Eintrag", e.fremd + " weitere Server-Einträge")} (anderer Name), ${mehrzahl(e.fremd, "der", "die")} auf den alten Werkzeug-Ordner ${mehrzahl(e.fremd, "zeigt", "zeigen")}. Kortex ändert fremde Einträge nicht.`, { ...(e.profil ? { profil: e.profil } : {}) });
      }
    });

    // --- 6. Hintergrunddienst (E20, E21) --------------------------------------------------------------------------------------------
    versuche(() => {
      const ordnerAgents = join(home, "Library", "LaunchAgents");
      let text = null;
      try { text = readFileSync(join(ordnerAgents, `${DIENST_LABEL}.plist`), "utf8"); } catch { /* kein Dienst */ }
      if (text !== null) {
        const strings = [...text.matchAll(/<string>([^<]*)<\/string>/g)].map((m) => unxml(m[1]));
        const brainVault = /<key>BRAIN_VAULT<\/key>\s*<string>([^<]*)<\/string>/.exec(text);
        const mitProfil = /<key>CLAUDE_CONFIG_DIR<\/key>\s*<string>[^<]*<\/string>/.test(text);
        const kitVerweis = strings.some((s) => nennt(s));
        const alt = !!brainVault || kitVerweis;
        if (alt) {
          const meiner = [resolve(vault), echt(vault)].map(falte);
          const imKit = (s) => { const m = new RegExp(`^(.*)/${maskiere(ALT_KIT_ORDNER)}(?:/|$)`).exec(s); return m ? m[1] : null; };
          let dieser = null;
          if (brainVault) dieser = meiner.includes(falte(resolve(unxml(brainVault[1])))) || meiner.includes(falte(echt(unxml(brainVault[1]))));
          else { const orte = strings.map(imKit).filter(Boolean); dieser = orte.length ? orte.some((o) => meiner.includes(falte(resolve(o))) || meiner.includes(falte(echt(o)))) : null; }
          const extra = { details: { fuerDiesenVault: dieser, mitProfil } };
          if (dieser) f("E20", "dienst-alt", "auto", "Hintergrunddienst", 1, "dienst-umstellen", "Der Hintergrunddienst startet noch das alte Programm aus dem Werkzeug-Ordner. Kortex stellt ihn auf den neuen Start um und behält dein Claude-Profil bei.", extra);
          else f("E20", dieser === false ? "dienst-alt-anderer-vault" : "dienst-alt-unklar", "frage", "Hintergrunddienst", 1, "dienst-umstellen-fragen", dieser === false ? "Der Hintergrunddienst läuft noch in alter Form und gehört zu einem anderen Vault. Möchtest du ihn für diesen Vault umstellen? Dann gilt er nicht mehr für den bisherigen." : "Der Hintergrunddienst läuft noch in alter Form, und Kortex kann nicht erkennen, zu welchem Vault er gehört. Möchtest du ihn für diesen Vault umstellen?", extra);
        }
      }
      let namen = [];
      try { namen = readdirSync(ordnerAgents).filter((n) => /^de\.brain\..+\.plist$/.test(n) && n !== `${DIENST_LABEL}.plist`); } catch { /* kein Ordner */ }
      if (namen.length) f("E21", "dienst-weitere", "hinweis", "Hintergrunddienst", namen.length, "info", `Auf diesem Mac ${mehrzahl(namen.length, "läuft ein weiterer Hintergrunddienst", "laufen " + namen.length + " weitere Hintergrunddienste")} aus der Kit-Zeit (${namen.map((n) => n.replace(/\.plist$/, "")).join(", ")}). Kortex ändert sie nicht.`, { details: { namen } });
    });

    // --- 7. Agenten-Dateien im Vault (E22) --------------------------------------------------------------------------------------------
    versuche(() => {
      const dateien = [[".claude/settings.json", ".claude/settings.json"], [".claude/settings.local.json", ".claude/settings.local.json"], [".mcp.json", ".mcp.json"], ["CLAUDE.md", "CLAUDE.md"]]
        .filter(([rel]) => zeilenMitVerweis(join(vault, rel)) > 0).map(([, n]) => n);
      if (dateien.length) f("E22", "vault-agenten", "hinweis", "Vault", dateien.length, "info", `Im Vault ${mehrzahl(dateien.length, "nennt eine Datei", "nennen " + dateien.length + " Dateien")} (${dateien.join(", ")}) den alten Werkzeug-Ordner. Kortex ändert diese Dateien nicht von allein; beim späteren Aufräumen macht Kortex dir einen Vorschlag.`, { details: { dateien } });
    });

    // --- 8. Shell-Startdateien (E24) ---------------------------------------------------------------------------------------------------
    versuche(() => {
      const shell = pruefeShellDateien(home);
      if (shell.length) f("E24", "shell", "hinweis", "Persönliche Einstellungen (Shell)", shell.reduce((a, s) => a + s.anzahl, 0), "info", `In ${shell.map((s) => s.name).join(", ")} ${shell.length === 1 && shell[0].anzahl === 1 ? "steht" : "stehen"} Zeilen, die auf den alten Werkzeug-Ordner zeigen. Kortex ändert deine Shell-Dateien nicht. Entferne oder ändere sie von Hand, bevor aufgeräumt wird.`, { details: { dateien: shell } });
    });

    // --- 9. Weitere Macs (E26) ---------------------------------------------------------------------------------------------------------
    versuche(() => {
      let ich = null;
      try { ich = JSON.parse(readFileSync(join(support, "umstellung", "geraet.json"), "utf8")).id ?? null; } catch { /* keine Geräte-ID */ }
      let andere = 0;
      let aufgeraeumt = 0;
      try { const namen = readdirSync(join(vault, ".kortex", "geraete")).filter((n) => /\.json$/.test(n) && n.replace(/\.json$/, "") !== ich); andere = namen.length; for (const n of namen) { try { if (typeof JSON.parse(readFileSync(join(vault, ".kortex", "geraete", n), "utf8")).phaseB === "string") aufgeraeumt++; } catch { /* unlesbar */ } } } catch { /* keine Merker */ }
      if (andere > 0) f("E26", "anderer-mac", "hinweis", "Vault", andere, "info", `Dieser Vault wurde auf ${mehrzahl(andere, "einem anderen Mac", andere + " anderen Macs")} schon mit Kortex umgestellt. Auf diesem Mac stellt Kortex nur die Einstellungen dieses Macs um; das Aufräumen im Vault übernimmt der erste Mac.${aufgeraeumt > 0 ? " Auf einem anderen Mac wurde der alte Werkzeug-Ordner schon aufgeräumt; hier verschwindet er beim nächsten Abgleich aus dem Vault." : ""}`, { details: { andereMacs: andere, aufgeraeumt } });
      const kv = cfg && typeof cfg.kernVersion === "string" ? cfg.kernVersion : null;
      if (kv && versionKleiner(kernVersion(), kv)) f("E26", "kortex-zu-alt", "blocker", "Vault", 1, "kortex-aktualisieren", "Kortex auf diesem Mac ist älter, als dein Vault es erwartet. Bitte aktualisiere Kortex, bevor du hier etwas umstellst.", { details: { vault: kv, kortex: kernVersion() } });
    });

    // --- 9b. Verwaiste Einbindungen in der globalen git-Konfiguration (E29): Vault verschoben oder gelöscht, der Block von Kortex zeigt ins Leere -------------------------
    versuche(() => {
      const gg = typeof env.GIT_CONFIG_GLOBAL === "string" && env.GIT_CONFIG_GLOBAL.startsWith("/") ? env.GIT_CONFIG_GLOBAL : join(home, ".gitconfig");
      const waisen = findeVerwaiste(gg);
      if (waisen.length) f("E29", "include-verwaist", "frage", "Persönliche Einstellungen (Versionsverlauf)", waisen.length, "include-aufraeumen", `In deinen persönlichen Einstellungen für den Versionsverlauf ${mehrzahl(waisen.length, "steht ein Eintrag", "stehen " + waisen.length + " Einträge")} von Kortex für ${mehrzahl(waisen.length, "einen Vault", "Vaults")}, den es an dieser Stelle nicht mehr gibt (verschoben oder gelöscht). Das schadet nicht. Kortex kann ${mehrzahl(waisen.length, "ihn", "sie")} auf Wunsch aufräumen; der Rückweg bleibt möglich.`, { phase: "B", details: { eintraege: waisen.length } });
    });

    // --- 10. Ort des Vaults (E27) und Altlasten außerhalb (E28) -------------------------------------------------------------------------
    versuche(() => {
      const merkmale = [];
      const echterPfad = echt(vault);
      if (/\/Mobile Documents\/|\/Library\/CloudStorage\//.test(`${vault}/`) || /\/Mobile Documents\/|\/Library\/CloudStorage\//.test(`${echterPfad}/`)) merkmale.push("cloud");
      if (/[ '"äöüÄÖÜß]|[^\x00-\x7f]/.test(vault)) merkmale.push("sonderzeichen");
      if (falte(echterPfad) !== falte(vault)) merkmale.push("verknuepfung");
      try { if (statSync(vault).dev !== statSync(tmp).dev) merkmale.push("anderes-volume"); } catch { /* ignorieren */ }
      if (merkmale.includes("cloud") && plattform === "darwin") {
        try { const d = execFileSync("/usr/bin/find", [vault, "-flags", "+dataless", "-print", "-quit"], { encoding: "utf8", timeout: 20_000, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] }); if (d.trim()) merkmale.push("nur-in-der-cloud"); } catch { /* find kennt das Flag nicht */ }
      }
      if (merkmale.length) {
        const sätze = {
          "cloud": "liegt in einem Cloud-Ordner (iCloud oder ähnlich)",
          "nur-in-der-cloud": "hat Dateien, die nur in der Cloud liegen (eine Probekopie lädt sie herunter)",
          "sonderzeichen": "hat Leerzeichen oder Sonderzeichen im Pfad",
          "verknuepfung": "wird über eine Verknüpfung erreicht",
          "anderes-volume": "liegt auf einem anderen Laufwerk als der Temp-Ordner (eine Probekopie dauert dann länger und braucht Platz)",
        };
        f("E27", "vault-ort", "hinweis", "Vault", merkmale.length, "info", `Dein Vault ${merkmale.map((m) => sätze[m]).join("; ")}. Das ist kein Problem, Kortex berücksichtigt es beim Ausprobieren an einer Kopie.`, { details: { merkmale } });
      }
    });
    versuche(() => {
      const alt = [];
      const lage = (p) => { try { lstatSync(p); return true; } catch { return false; } };
      if (plattform === "darwin" && lage(join(home, "Library", "Application Support", "Brain"))) alt.push("alter-support-ordner");
      if (lage(join(home, ".brain-kit"))) alt.push("brain-kit");
      if (alt.length) f("E28", "altlasten-aussen", "hinweis", "Persönliche Ordner", alt.length, "info", "Auf diesem Mac liegen noch alte Ordner aus der Zeit vor Kortex. Sie stören nicht; Kortex liest sie nur als Rückfall und ändert nichts daran.", { details: { ordner: alt } });
    });
  }

  const zaehlung = { auto: 0, frage: 0, hinweis: 0, blocker: 0, blockerPhaseA: 0 };
  for (const x of funde) { zaehlung[x.schwere]++; if (x.schwere === "blocker" && (x.blockiertPhase || "A") === "A") zaehlung.blockerPhaseA++; }
  const kitZeit = funde.some((x) => ["kit-ordner", "hookspfad-alt", "claude-hooks", "claude-befehle", "mcp-alt", "dienst-alt", "dienst-alt-anderer-vault", "dienst-alt-unklar"].includes(x.kategorie));
  return {
    version: BEFUND_VERSION, kernVersion: kernVersion(), kitZeit, umstellbar: zaehlung.blockerPhaseA === 0, zaehlung,
    profile: (claudeHomes && claudeHomes.length ? profileAusPfaden(claudeHomes, home) : erkenneProfile(home)).map((p) => ({ name: p.name, pfad: p.pfad, standard: p.standard })),
    funde,
  };
}
