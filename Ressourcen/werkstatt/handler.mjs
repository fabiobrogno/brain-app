// werkstatt/handler.mjs — die Routen von Brain Studio (Spec §5) als reine Funktion, ohne Socket:
//   erzeugeHandler({vault, ...}) → async ({methode, pfad, query, body}) => ({status, headers, body: Buffer, stopp?})
// Genutzt von werkstatt.mjs (Brücke zur App) und entwicklung.mjs (HTTP für Tests). Statische Dateien kommen aus ../studio/.
import { readFileSync, realpathSync, statSync, existsSync, writeFileSync, copyFileSync, mkdirSync, renameSync, readdirSync, rmSync, chmodSync, constants as fsKonst } from "node:fs";
import { join, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { createInterface } from "node:readline";
import { oeffneVault, HttpFehler } from "../gemeinsam/vault.mjs";
import { kindUmgebung, supportOrdner, falte, kernOrdner } from "../gemeinsam/basis.mjs";
import { starte, neueFrist, registriere, beendeGruppe } from "../gemeinsam/prozess.mjs";
import { findeProgramm, erkenneAgenten, erkenneKatalog } from "../gemeinsam/ki.mjs";
import * as vaultsFn from "../gemeinsam/vaults.mjs";
import * as vertrauenFn from "../gemeinsam/vertrauen.mjs";
import { erzeugeGitHub } from "../gemeinsam/github.mjs";
import { sicherungStand } from "../gemeinsam/gitsicherung.mjs";
import { erzeugeVerdrahtung } from "./verdrahtung.mjs";
import { erzeugeUmstellung } from "./umstellung.mjs";
import { erzeugeEreignisse } from "./ereignisse.mjs";
import { profilZuPfad, mitProfil, mitCodexHome } from "./profile.mjs";
import { erzeugeKonten } from "./konten.mjs";
import { erzeugeFrage } from "./frage.mjs";
import { erzeugeEinstellungen } from "./einstellungen.mjs";
import { STUFEN, pflegeFuer, stufeFuer, darfMindestens } from "../gemeinsam/ki-konten.mjs";
import { erzeugePflege } from "./pflege.mjs";
import { merkeRemoteBestaetigt } from "../gemeinsam/sicherungsmerker.mjs";
import { ADAPTER, erkenneProgramme } from "./ki-programme/index.mjs";

const HIER = dirname(fileURLToPath(import.meta.url));
export const MAX_KOERPER = 8 * 1024 * 1024;

// script-src ausdrücklich (statt nur über default-src): Skripte laufen nur aus Dateien der Werkstatt, nie inline und nie von fremden Adressen — eine in eine Notiz eingeschmuggelte <script>-Zeile bleibt wirkungslos.
const CSP = "default-src 'self'; script-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; connect-src 'self'; base-uri 'none'; object-src 'none'; form-action 'none'; frame-ancestors 'none'";
const TYPEN = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".ico": "image/x-icon",
  ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".txt": "text/plain; charset=utf-8", ".webmanifest": "application/manifest+json",
};
const JSON_KOPF = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

const json = (status, daten) => ({ status, headers: { ...JSON_KOPF }, body: Buffer.from(JSON.stringify(daten)) });
const fehler = (status, meldung, extra = {}) => json(status, { fehler: meldung, ...extra });

export function appVersionLesen() {
  if (process.env.BRAIN_APP_VERSION) return process.env.BRAIN_APP_VERSION;
  for (const p of [join(HIER, "..", "Info.plist"), join(HIER, "..", "..", "Info.plist")]) {
    try { const m = /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/.exec(readFileSync(p, "utf8")); if (m) return m[1]; } catch { /* nächster */ }
  }
  return "dev";
}

const ZIELE_TEXT = `Unbekanntes Ziel — möglich ist: ${["claude", "codex", ...Object.keys(ADAPTER)].join(", ")}.`;
const shellText = (s) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);

// `claude` im PATH und an den üblichen Orten suchen (Logik und Test-Schalter BRAIN_CLAUDE_EXTRA/BRAIN_TESTMODUS: gemeinsam/ki.mjs).
export const findeClaude = (env = process.env) => findeProgramm("claude", env);

function statisch(pfad, studioDir) {
  const nicht = fehler(404, "nicht gefunden");
  let dekodiert;
  try { dekodiert = decodeURIComponent(pfad); } catch { return nicht; }
  if (/[\\\0]/.test(dekodiert)) return nicht;
  const teile = dekodiert.split("/").filter((t) => t !== "");
  if (teile.some((t) => t === ".." || t === "." || t.startsWith("."))) return nicht;
  if (!teile.length) teile.push("index.html");
  try {
    const wurzel = realpathSync(studioDir);
    let echt = realpathSync(join(wurzel, ...teile));
    if (statSync(echt).isDirectory()) echt = realpathSync(join(echt, "index.html"));
    if (!echt.startsWith(wurzel + sep) || !statSync(echt).isFile()) return nicht;
    const i = echt.lastIndexOf(".");
    const typ = TYPEN[i > 0 ? echt.slice(i).toLowerCase() : ""] || "application/octet-stream";
    return { status: 200, headers: { "Content-Type": typ, "Cache-Control": "no-cache", "Content-Security-Policy": CSP,
      "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" }, body: readFileSync(echt) };
  } catch { return nicht; }
}

const STANDARD_FARBE = "#7C8798";
const istOrdner = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const echterPfad = (p) => { try { return realpathSync(p); } catch { return p; } };
// Derselbe Ordner? (kanonische Pfade, ohne Groß/klein und Unicode-Form; ein Pfad, den es nicht gibt, ist nie derselbe)
const gleicherOrdner = (a, b) => { try { return falte(realpathSync.native(a)) === falte(realpathSync.native(b)); } catch { return false; } };

export function erzeugeHandler(o) {
  const vaultOpt = o.vaultOptionen || {};
  const optV = () => (vaultOpt.support ? { support: vaultOpt.support } : {});
  // Der Nutzer hat dieses Remote gerade selbst eingerichtet: der Kern darf dorthin sichern (kern/backup.mjs, sicherungsmerker.mjs)
  const merkeRemote = (wurzel, url) => merkeRemoteBestaetigt(wurzel, String(url).trim(), { support: vaultOpt.support });
  const studioDir = o.studioDir || join(HIER, "..", "studio");
  const appVersion = o.appVersion || appVersionLesen();
  const mcpPfad = o.mcpPfad || join(HIER, "..", "mcp", "brain-mcp.mjs");
  const nodePfad = o.nodePfad || process.execPath;
  // Der MCP-Server liegt zusätzlich im gebündelten Kern (<kern>/mcp/brain-mcp.mjs; der App-Bau legt ihn mit dem gemeinsamen Code dorthin).
  // Neue Einträge zeigen auf den STABILEN Kern-Pfad (<support>/bin/kern, `KORTEX_KERN_PFAD`), nicht auf das App-Paket: so überstehen sie
  // App-Verschieben und -Updates. Ein ausdrücklich übergebener `mcpPfad` (Tests) gilt nur zusammen mit einem ausdrücklichen `kern`.
  const kernMcp = o.kern || !o.mcpPfad ? join(o.kern || kernOrdner(), "mcp", "brain-mcp.mjs") : null;

  // Workspace-Trust (P5): alte Vertrauens-Merker (Stand vor P5) für Vaults aus der Liste werden einmal übernommen, alle anderen alten fallen weg.
  try {
    vertrauenFn.migriereAltesVertrauen({ support: vaultOpt.support || supportOrdner(), vaultPfade: vaultsFn.leseVaults(optV()).vaults.map((e) => e.pfad) });
  } catch { /* die Frage im Studio fängt es ab */ }

  // GitHub-Anmeldung (Gerätecode): die Client-ID kommt aus der Umgebung (Info.plist → App), nie aus dem Code. o.github = Ersatz für Tests.
  const github = o.github || erzeugeGitHub({ clientId: process.env.KORTEX_GITHUB_CLIENT_ID, basis: process.env.BRAIN_GITHUB_BASIS, apiBasis: process.env.BRAIN_GITHUB_API,
    helper: process.env.BRAIN_GITHUB_HELPER });

  // Der offene Vault kann zur Laufzeit wechseln (POST /api/vaults/…): jede Anfrage hält den bei ihrem Start offenen Vault fest.
  // Start: Vault-Argument hat Vorrang; sonst der aktive Vault aus vaults.json; sonst ohne Vault (Willkommen).
  let aktuell = null;
  const oeffne = (pfad) => oeffneVault(pfad, vaultOpt);
  // Live-Aktualisierung (ereignisse.mjs): beobachtet den offenen Vault, sobald die Oberfläche zum ersten Mal nach Ereignissen fragt. o.ereignisse = Einstellungen für Tests.
  const ereignisse = erzeugeEreignisse({ support: vaultOpt.support || supportOrdner(), ...(o.ereignisse || {}) });
  // Eine laufende Frage („Frag deinen Vault“) gehört zum bisherigen Vault: bei jedem Wechsel endet sie (frage.brichAb).
  const wechsleZu = (pfad) => { frage.brichAb("vault"); aktuell = pfad ? oeffne(pfad) : null; ereignisse.richteAuf(aktuell ? aktuell.wurzel : null); };
  if (o.vault) aktuell = oeffne(o.vault); // falscher Ordner → HttpFehler wie bisher
  else {
    const p = vaultsFn.aktiverVaultPfad(optV());
    if (p) { try { aktuell = oeffne(p); } catch { aktuell = null; } }
  }
  ereignisse.richteAuf(aktuell ? aktuell.wurzel : null);

  // KI-Konten (docs/plaene/ki-konten.md): welche Konten gibt es, was darf jedes in welchem Vault. Die Werkstatt gleicht die Liste beim Start der App ab (werkstatt.mjs)
  // und bei jedem Aufruf von /api/ki/konten. o.kontenErkennung / o.kontenVerbunden / o.kontenHome: Ersatz für Tests (nie die echten Orte des Rechners lesen).
  const konten = erzeugeKonten({ support: vaultOpt.support || supportOrdner(), vaults: () => vaultsFn.leseVaults(optV()).vaults,
    ...(o.kontenHome ? { home: () => o.kontenHome } : {}), ...(o.kontenErkennung ? { erkennung: o.kontenErkennung } : {}), ...(o.kontenVerbunden ? { verbunden: o.kontenVerbunden } : {}) });

  // Der Eintrag bei Claude Code nennt keinen Vault: der MCP-Server folgt dem aktiven Vault aus vaults.json (Spec v2 §8).
  // Der Kern-Pfad bleibt wie er ist (kein realpath: der Symlink bin/kern ist der stabile Teil), der Paket-Pfad ist der aufgelöste (Rückfall).
  // Mit `konto` trägt der Eintrag `--konto <id>`: der Server weiß dann, für welches KI-Konto er läuft (Stufen je Vault).
  const mcpArgs = (konto = null) => {
    let basis = null;
    if (kernMcp) { try { statSync(kernMcp); basis = [nodePfad, kernMcp]; } catch { /* nicht im Kern: Rückfall auf das App-Paket */ } }
    if (!basis) { try { statSync(mcpPfad); } catch { return null; } basis = [nodePfad, realpathSync(mcpPfad)]; }
    return konto ? [...basis, "--konto", konto] : basis;
  };
  const mcpBefehl = (konto = null) => { const a = mcpArgs(konto); return a ? `claude mcp add -s user brain -- ${a.map(shellText).join(" ")}` : null; };
  const codexBefehl = (konto = null) => { const a = mcpArgs(konto); return a ? `codex mcp add brain -- ${a.map(shellText).join(" ")}` : null; };
  // Welches Konto gehört zu diesem Verbinden/Trennen? e.konto (id aus der Liste) · bei Claude e.profil · sonst das Standardkonto des Programms (beim Verbinden wird es
  // bei Bedarf eingetragen). Fehlt es, bleibt der Eintrag in der Altform ohne --konto (ohne Konto gilt dann „ohneKonto“ des Vaults).
  // o.kontenAus (nur Tests, die die Altform der Einträge prüfen): kein Konto, nie `--konto`.
  const kontoFuer = (e, programm, { anlegen = false } = {}) => {
    if (o.kontenAus === true) return null;
    try {
      if (e.konto !== undefined) {
        const k = typeof e.konto === "string" ? konten.kontoDaten(e.konto) : null;
        if (!k || k.programm !== programm) throw new HttpFehler(400, "Dieses KI-Konto gibt es nicht (mehr). Suche die Konten bitte neu.");
        return e.konto;
      }
      if (programm === "claude" && e.profil !== undefined) {
        const pr = profilZuPfad(e.profil);
        if (!pr) return null;
        let id = konten.kontoFuerProfil(pr.pfad);
        if (!id && anlegen) { konten.synchronisiere(); id = konten.kontoFuerProfil(pr.pfad); }
        return id;
      }
      return konten.kontoFuerProgramm(programm, { anlegen });
    } catch (err) { if (err instanceof HttpFehler) throw err; return null; }
  };
  // Claude-Profil und Codex-Ordner eines Kontos für die Umgebung der Kindprozesse.
  const profilVon = (kontoId) => { const k = kontoId ? konten.kontoDaten(kontoId) : null; return k && k.programm === "claude" ? { pfad: k.ordner, standard: k.standard === true } : null; };
  // KI-Programme mit Einstellungsdatei (Cursor, Claude Desktop, Gemini CLI …): ki-programme/. Alle laufen durch denselben Adapter.
  // Vergleich eines vorhandenen Eintrags mit unserem: "gleich" | "alt" | "anders" (siehe befehlsArt); Command/Args stehen nie in Antworten.
  const eintragArtMit = (a, command, args) => (a ? vergleicheEintrag(command, args, a) : "anders");
  const adapterCtx = (konto = null) => { const a = mcpArgs(konto); return { home: homedir(), a, art: (command, args) => eintragArtMit(a, command, args) }; };
  const adapterText = (id, konto = null) => ADAPTER[id].konfiguration(adapterCtx(konto));
  // Gesamtfristen je Route in ms (nur im Test kürzer): mcp/verbinden 25 s, Probe über den MCP-Server 10 s.
  const fristen = { mcpVerbinden: 25_000, probe: 10_000, ...(o.fristen || {}) };
  // Einrichtung über den Starter der App (Hooks bei Claude Code, Prüfung vor dem Speichern, Hintergrunddienst): werkstatt/verdrahtung.mjs. o.starter = Ersatz für Tests.
  const verdrahtung = erzeugeVerdrahtung({ starter: o.starter || join(vaultOpt.support || supportOrdner(), "bin", "kortex"), support: vaultOpt.support || supportOrdner(),
    kontoFuerProfil: (pfad) => { if (o.kontenAus === true) return null; try { return konten.kontoFuerProfil(pfad) || (konten.synchronisiere(), konten.kontoFuerProfil(pfad)); } catch { return null; } },
    freigeben: (konto, vault, stufe, ausdruecklich = false) => konten.setzeZugriff({ konto, vault: vault.wurzel, stufe, quelle: "assistent", ausdruecklich }) ,
    // Ein Profil, das der Assistent beim Einrichten des Dienstes mitschickt, schlägt nur das Pflege-Konto vor: nur mit „erweitert“ für diesen Vault und nur, wenn der Vault noch keine Pflege-Einstellung hat.
    pflegeAusProfil: (vault, profilPfad) => {
      if (o.kontenAus === true) return;
      const id = konten.kontoFuerProfil(profilPfad); const d = konten.lade();
      if (!id || !d || pflegeFuer(d, vault.wurzel).gesetzt || !darfMindestens(stufeFuer(d, vault.wurzel, id), "erweitert")) return;
      konten.setzePflege({ vault: vault.wurzel, konto: id, stufe: "mittel" }, { nurWennUngesetzt: true });   // Stufe und „noch nichts eingestellt“ werden unter der Sperre der Liste geprüft
    } });
  // Pflege je Vault (letzter/nächster Lauf, Dienst, Übernahme des alten Profils der plist): werkstatt/pflege.mjs
  const pflege = erzeugePflege({ support: vaultOpt.support || supportOrdner(), konten, ...(o.kontenHome ? { home: () => o.kontenHome } : {}), vaults: () => vaultsFn.leseVaults(optV()).vaults });
  // Die Übernahme des festen Claude-Profils aus der alten plist (docs/plaene/ki-konten.md, P3), idempotent und bei jedem Start und jedem Öffnen der KI-Konten erneut versucht, solange die plist die Variable trägt:
  // erst die Pflege-Einstellung der Vaults des Dienstes (pflege.migriere), dann die plist neu schreiben (`dienst an` mit Sicherung *.vor-pflege und Rückfall bei Ladefehler, Kern). Die plist wird nur für einen
  // Vault neu geschrieben, der zum Dienst gehört (ein anderer wird dadurch nie neu eingeschaltet). Misserfolg: `plistOffen` + Grund in der Liste, das Studio zeigt es; die alte plist bleibt wirksam.
  async function plistNeuSchreiben(v) {
    if (!v) return { grund: "kein-vault" };
    let echt = v.wurzel; try { echt = realpathSync.native(v.wurzel); } catch { /* wie angegeben */ }
    if (!pflege.dienstVaults().includes(echt)) return { grund: "nicht-im-dienst" };
    try { await verdrahtung.verdrahte(v, { was: "dienst", an: true }); return { ok: true }; }
    catch (e) { return { grund: e instanceof HttpFehler && e.extra && typeof e.extra.art === "string" ? e.extra.art : "fehler" }; }
  }
  // Das Neuschreiben (bootout/bootstrap des LaunchAgents) wird beim Start und danach höchstens alle 10 Minuten versucht, nicht bei jedem Öffnen der KI-Konten; die Übernahme in die Einstellungen läuft immer.
  let letzterPlistVersuch = 0;
  async function migrierePflege(v, { start = false } = {}) {
    if (o.kontenAus === true) return;
    const jetzt = Date.now();
    const versuch = start || jetzt - letzterPlistVersuch > 600_000;
    try { await pflege.migriere({ neuschreiben: versuch ? async () => { letzterPlistVersuch = Date.now(); return plistNeuSchreiben(v); } : null }); } catch { /* bleibt als Rückfall */ }
  }
  // „Frag deinen Vault“ (P4): eine Frage an Claude Code, die den Vault nur über den Kortex-MCP liest — werkstatt/frage.mjs. o.frageEnv / o.frageGrenzen / o.frageTemp: Ersatz für Tests
  // (Umgebung für Programmsuche und Kindprozess, kürzere Grenzen, Temp-Ordner); sonst gilt die Umgebung dieser Werkstatt als Quelle für PATH/HOME/LANG, nie mehr.
  const frage = erzeugeFrage({ support: vaultOpt.support || supportOrdner(), konten, mcpBasis: () => mcpArgs(), basisEnv: o.frageEnv || process.env,
    home: () => o.kontenHome || homedir(), grenzen: o.frageGrenzen || {}, tempBasis: o.frageTemp || null });
  // Seite „Einstellungen“ (P5): GET/PUT /api/einstellungen führt die Werte eines Vaults (kern/einstellungen.mjs, wie `brain einstellungen`) und die der App (<support>/einstellungen.json) zusammen.
  const einstellungen = erzeugeEinstellungen({ support: vaultOpt.support || supportOrdner(), kern: () => o.kern || kernOrdner() });
  // Umstellung eines Vaults aus der Kit-Zeit (P7a Befund, P7b Probelauf/Phase A/Rückweg): werkstatt/umstellung.mjs
  const umstellung = erzeugeUmstellung({ starter: o.starter || join(vaultOpt.support || supportOrdner(), "bin", "kortex"), support: vaultOpt.support || supportOrdner() });

  // Liste für die Oberfläche: gespeicherte Vaults (+ ein nur für diesen Start geöffneter, der nicht in vaults.json steht).
  function vaultListe(v) {
    const l = vaultsFn.leseVaults(optV());
    const aktivPfad = v ? v.wurzel : null;
    const vaults = l.vaults.map((e) => ({ name: e.name, pfad: e.pfad, farbe: e.farbe, aktiv: echterPfad(e.pfad) === aktivPfad, vorhanden: istOrdner(e.pfad), git: existsSync(join(e.pfad, ".git")) }));
    if (v && !vaults.some((e) => e.aktiv)) vaults.unshift({ name: v.name, pfad: v.wurzel, farbe: STANDARD_FARBE, aktiv: true, vorhanden: true, git: existsSync(join(v.wurzel, ".git")), temporaer: true });
    return { vaults, aktiv: aktivPfad, ...(l.defekt ? { defekt: true } : {}) }; // defekt: eine kaputte vaults.json wurde gesichert und ersetzt
  }

  async function api(methode, pfad, q, koerper, v) {
    const eingabe = () => {
      if (!koerper || !koerper.length) throw new HttpFehler(400, "Die Anfrage hat keinen Inhalt.");
      try { const j = JSON.parse(koerper.toString("utf8")); if (j && typeof j === "object" && !Array.isArray(j)) return j; } catch { /* unten */ }
      throw new HttpFehler(400, "Die Anfrage ist kein gültiges JSON.");
    };
    const nur = (erlaubt) => { if (methode !== erlaubt) throw new HttpFehler(405, "Diese Methode ist hier nicht erlaubt."); };
    // Routen ohne Vault: info, vaults/*, ki/erkennen, stopp. Alle anderen brauchen einen offenen Vault.
    const V = () => { if (!v) throw new HttpFehler(409, "Es ist noch kein Vault geöffnet.", { keinVault: true }); return v; };
    // Ein von Kortex angelegter/geklonter/geöffneter Vault kommt in die Liste der KI-Konten (alle gesperrt; das einzige Konto bei angelegt/geklont posteingang).
    // Liegt der neue Vault in einem anderen Vault (oder umgekehrt)? Die Liste der App lässt das nicht zu (vaults.mjs), aber ein Ordner mit eigener brain.config.json kann trotzdem in einem Vault liegen
    // (nie angemeldet, geklont, hineinkopiert). Dann gelten die Zugriffsrechte je Vault, und KI-Konten sehen den inneren nicht als Teil des äußeren: Warnung für den Nutzer.
    const verschachtelt = (pfad) => {
      let mein; try { mein = realpathSync.native(pfad); } catch { return null; }
      let oben = dirname(mein);
      for (let i = 0; i < 8 && oben !== dirname(oben); i++, oben = dirname(oben)) {
        if (existsSync(join(oben, "brain.config.json"))) return "Dieser Vault liegt in einem anderen Vault. KI-Konten, die den äußeren Vault sehen dürfen, sehen diesen inneren nicht mit: Die Zugriffsrechte gelten je Vault (Einstellungen → KI-Konten).";
      }
      const gefunden = []; let besucht = 0;
      const lauf = (dir, tiefe) => {
        if (tiefe > 3 || besucht > 2000 || gefunden.length) return;
        let liste; try { liste = readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const d of liste) {
          if (!d.isDirectory() || d.name.startsWith(".") || d.name === "node_modules") continue;
          besucht++;
          const u = join(dir, d.name);
          if (existsSync(join(u, "brain.config.json"))) { gefunden.push(d.name); return; }
          lauf(u, tiefe + 1);
        }
      };
      lauf(mein, 1);
      return gefunden.length ? `In diesem Vault liegt der Ordner „${gefunden[0]}“, der selbst ein Vault ist. KI-Konten sehen ihn nicht als Teil dieses Vaults: Die Zugriffsrechte gelten je Vault (Einstellungen → KI-Konten).` : null;
    };
    const neuerStand = (r, herkunft = "geoeffnet") => { const warnung = verschachtelt(r.vault.pfad); try { konten.vaultHinzu(r.vault.pfad, herkunft); } catch { /* der Vault ist gesperrt, bis die Liste wieder geht */ } wechsleZu(r.vault.pfad); return { ...vaultListe(aktuell), vault: r.vault, git: r.git, ...(warnung ? { warnung } : {}) }; };
    // POST /api/aufgaben/archivieren { pfad } | { aelterAlsTage }: erledigte Aufgaben ins Archiv verschieben (kein Löschen; nur in einem vertrauten Vault).
    // Vor der PATCH-Route: „archivieren“ ist nie ein Aufgabenpfad (die haben immer den Ordner davor).
    if (pfad === "/api/aufgaben/archivieren") { nur("POST"); return V().aufgabenArchivieren(eingabe()); }
    // PATCH /api/aufgaben/<pfad der Aufgabe im Vault>: Status, Rang, Felder einer Aufgabe ändern
    if (pfad.startsWith("/api/aufgaben/")) {
      nur("PATCH");
      let rel;
      try { rel = decodeURIComponent(pfad.slice("/api/aufgaben/".length)); } catch { throw new HttpFehler(400, "Der Pfad der Aufgabe ist ungültig."); }
      return V().aufgabeAendern(rel, eingabe());
    }
    switch (pfad) {
      case "/api/info": {
        nur("GET");
        if (!v) return { vault: null, name: null, appVersion, kitVersion: null, git: false, mcpBefehl: null, kit: { vorhanden: false }, vertrauen: null };
        const stand = v.vertrauenStand();
        const kc = (programm) => { if (o.kontenAus === true) return null; try { return konten.kontoFuerProgramm(programm); } catch { return null; } }; // nur nachsehen, nichts anlegen
        return { vault: v.wurzel, name: v.name, appVersion, kitVersion: v.kitVersion(), git: await v.istGitRepo(), mcpBefehl: mcpBefehl(kc("claude")), mcpBefehle: { claude: mcpBefehl(kc("claude")), codex: codexBefehl(kc("codex")), ...Object.fromEntries(Object.keys(ADAPTER).map((id) => [id, adapterText(id, kc(id))])) }, kit: v.kit(), vertrauen: stand };
      }
      case "/api/vertrauen": {
        // Workspace-Trust (P5). { erlauben, vault }: vault ist der Pfad, den der Dialog gezeigt hat. Der offene Vault kann zwischen Anzeige und Klick
        // gewechselt haben (Vault-Wechsel, Abgleich, anderes Fenster) — vertraut (oder entzogen) wird nie ein Vault, den der Nutzer nicht vor sich hatte.
        nur("POST");
        const e = eingabe();
        if (typeof e.erlauben !== "boolean") throw new HttpFehler(400, "„erlauben“ muss true oder false sein.");
        const offen = V();
        if (typeof e.vault !== "string" || !e.vault.trim()) throw new HttpFehler(400, "Der Vault fehlt: Die Anfrage nennt den Ordner, den der Dialog gezeigt hat.");
        if (!gleicherOrdner(e.vault, offen.wurzel)) {
          throw new HttpFehler(409, "Der geöffnete Vault ist inzwischen ein anderer als der, für den die Frage galt. Es wurde nichts geändert — bitte noch einmal prüfen.", { art: "anderer-vault" });
        }
        return offen.vertrauen(e.erlauben);
      }
      // Live-Aktualisierung: Long-Poll auf Ereignisse. seit fehlt → nur den Stand nennen; sonst sofort, was nach <seit> kam, oder bis zu <warte> Sekunden warten.
      case "/api/ereignisse": {
        nur("GET");
        if (v) { try { ereignisse.setzeAufgabenOrdner(await v.aufgabenOrdnerName()); } catch { /* Standardordner */ } }
        const seit = q.get("seit"), warte = Number(q.get("warte") ?? 25);
        if (seit !== null && seit !== "" && !/^\d{1,15}$/.test(seit)) throw new HttpFehler(400, "„seit“ ist eine Ereignis-Nummer.");
        return ereignisse.warte({ seit: seit === null || seit === "" ? null : Number(seit), epoche: q.get("epoche") || null, warteMs: (Number.isFinite(warte) ? Math.max(0, warte) : 25) * 1000 });
      }
      case "/api/einstellungen":
        if (methode === "GET") return einstellungen.lesen(v);
        nur("PUT");
        return einstellungen.schreiben(v, eingabe());
      case "/api/baum": nur("GET"); return V().baum();
      case "/api/datei":
        if (methode === "GET") return V().lies(q.get("pfad"));
        if (methode === "PUT") { const e = eingabe(); return V().schreibe({ pfad: e.pfad, inhalt: e.inhalt, basisHash: e.basisHash }); }
        throw new HttpFehler(405, "Diese Methode ist hier nicht erlaubt.");
      case "/api/neu": nur("POST"); return V().neu(eingabe());
      case "/api/merken": nur("POST"); return V().merken(eingabe());
      // Aufgaben (kern/aufgaben.mjs): lesen immer, anlegen und ändern nur in einem vertrauten Vault (409 art „nicht-vertraut“)
      case "/api/aufgaben":
        if (methode === "GET") return V().aufgaben();
        if (methode === "POST") return V().aufgabeAnlegen({ ...eingabe(), quelle: "mensch" }); // die Quelle gibt nie die Anfrage vor
        throw new HttpFehler(405, "Diese Methode ist hier nicht erlaubt.");
      case "/api/posteingang/verwerfen": nur("POST"); return V().posteingangVerwerfen(eingabe());
      case "/api/posteingang/spaeter": nur("POST"); return V().posteingangSpaeter(eingabe());
      case "/api/posteingang/uebernehmen": nur("POST"); return V().posteingangUebernehmen(eingabe());
      case "/api/suche": nur("GET"); return V().suche(q.get("q"));
      case "/api/pruefung": nur("GET"); return V().pruefung(q.get("pfad"));
      case "/api/gesundheit": nur("GET"); return V().gesundheit();
      case "/api/rueckfragen": nur("GET"); return V().rueckfragen();
      case "/api/nutzung": nur("GET"); return V().nutzung();
      case "/api/notizen": nur("GET"); return V().notizen();
      case "/api/notiz/kontext": nur("GET"); return V().notizKontext(q.get("pfad"));
      case "/api/typen": nur("GET"); return V().typen();
      case "/api/ansichten": nur("GET"); return V().ansichten();
      // Notizen + Typen + Ansichten aus EINEM Lauf (Oberfläche: ein Abruf statt drei) und Teil-Index nach Live-Ereignissen (nur die genannten, bereits bekannten Dateien)
      case "/api/index": nur("GET"); return V().indexAlles();
      case "/api/teilindex": nur("POST"); return V().teilIndex(eingabe().pfade);
      case "/api/probe": {
        nur("POST");
        const e = eingabe();
        if (typeof e.frage !== "string" || !e.frage.trim() || e.frage.length > 500) throw new HttpFehler(400, "Bitte eine Frage eingeben (höchstens 500 Zeichen).");
        return probeUeberMcp(V(), e.frage.trim(), e.anzahl);
      }
      case "/api/mcp/selbsttest": nur("POST"); return probeUeberMcp(V(), "Vault", 1, { liste: true, wer: "die KI" });
      case "/api/git/status": nur("GET"); return V().gitStatus();
      case "/api/git/commit": nur("POST"); return V().gitCommit(eingabe());
      case "/api/git/sync": nur("POST"); return V().gitSync(koerper && koerper.length ? eingabe() : {});
      case "/api/git/konflikt": // GET: Ansicht des offenen Konflikts · POST { basis }: Ansicht eines gemerkten Stands (nach „Rückgängig“)
        if (methode === "POST") return V().gitKonfliktAnsicht(eingabe().basis);
        nur("GET"); return V().gitKonfliktAnsicht();
      case "/api/git/konflikt/loesen": nur("POST"); return V().gitKonfliktLoesen(eingabe());
      case "/api/git/konflikt/rueckgaengig": nur("POST"); return V().gitKonfliktRueckgaengig();
      case "/api/git/konflikt/abbrechen": nur("POST"); return V().gitKonfliktAbbrechen();
      case "/api/git/nachsehen": nur("POST"); return V().gitNachsehen();
      case "/api/git/wiederherstellen/vorschau": nur("GET"); return V().gitWiederherstellenVorschau(q.get("pfad"), q.get("sha"));
      case "/api/git/wiederherstellen": nur("POST"); return V().gitWiederherstellen(eingabe());
      case "/api/git/verlauf": nur("GET"); return V().gitVerlauf(q.get("pfad"), q.get("max"));
      case "/api/git/log": nur("GET"); return V().gitLog({ max: q.get("max"), vor: q.get("vor") || undefined });
      case "/api/git/remote": { nur("POST"); const url = eingabe().url; const erg = await V().gitRemote(url); merkeRemote(V().wurzel, url); return erg; }
      case "/api/git/diff": nur("GET"); return V().gitDiff(q.get("pfad"), q.get("sha") || undefined);
      case "/api/git/fassung": nur("GET"); return V().gitFassung(q.get("pfad"), q.get("sha"));
      case "/api/kern/stand": nur("GET"); return verdrahtung.stand(v);
      case "/api/kern/verdrahten": nur("POST"); return verdrahtung.verdrahte(v, eingabe());
      case "/api/umstellung/hinweis": nur("GET"); return umstellung.hinweis(v);
      case "/api/umstellung/befund": nur("GET"); return umstellung.befund(v);
      case "/api/umstellung/stand": nur("GET"); return umstellung.stand(v);
      case "/api/umstellung/protokoll": nur("GET"); return umstellung.protokoll(v);
      case "/api/umstellung/kopie-loeschen": nur("POST"); return umstellung.kopieLoeschen(v, eingabe());
      case "/api/umstellung/probelauf": nur("POST"); return umstellung.probelauf(v, eingabe());
      case "/api/umstellung/phase-a": nur("POST"); return umstellung.phaseA(v, eingabe());
      case "/api/umstellung/phase-b": nur("POST"); return umstellung.phaseB(v, eingabe());
      case "/api/umstellung/aufraeumen": if (methode === "GET") return umstellung.aufraeumen(v); nur("POST"); return umstellung.aufraeumenTun(v, eingabe());
      case "/api/umstellung/rueckweg": nur("POST"); return umstellung.rueckweg(v, eingabe());
      case "/api/mcp/verbinden": { nur("POST"); V(); return verbinde(eingabe(), v); }
      case "/api/mcp/trennen": { nur("POST"); return trenne(eingabe()); }
      case "/api/mcp/konfiguration": { nur("GET"); return konfiguration(q); }
      case "/api/ki/erkennen": {
        nur("GET");
        const neu = q.get("neu") === "1";
        const erg = await erkenneAgenten({ neu });
        // Programme mit Einstellungsdatei (Cursor meldet weiter `cursorDa`); `katalog`: alle Programme des KI-Katalogs (gemeinsam/ki-katalog.json) mit Fund und Version
        return { ...erg, programme: erkenneProgramme({ agenten: erg.agenten }), katalog: await erkenneKatalog({ neu }) };
      }
      // KI-Konten (docs/plaene/ki-konten.md): Liste mit Stufen je Vault · Name/Abo setzen · Stufe eines Kontos in einem Vault setzen
      case "/api/ki/konten":
        if (methode === "GET") { await migrierePflege(v); return konten.stand(); }
        nur("POST"); return konten.setzeName(eingabe());
      case "/api/ki/zugriff": nur("PUT"); return konten.setzeZugriff(eingabe());
      // Frag deinen Vault (P4): Start → Long-Poll auf den Stand → Abbruch. Nichts wird gespeichert.
      case "/api/frage/bereit": nur("GET"); return frage.bereit(V());
      case "/api/frage/start": nur("POST"); return frage.start(eingabe(), V());
      case "/api/frage/stand": nur("GET"); return frage.stand(q, V());
      case "/api/frage/abbrechen": nur("POST"); return frage.abbrechen(eingabe(), V());
      case "/api/ki/standard": nur("PUT"); return konten.setzeStandard(eingabe());
      // Pflege je Vault: Konto und KI-Stufe setzen · Stand lesen (letzter/nächster Lauf) · jetzt einmal pflegen
      case "/api/ki/pflege":
        if (methode === "GET") { const vp = q.get("vault"); if (!vp) throw new HttpFehler(400, "Der Vault muss angegeben werden."); return pflege.status(vp); }
        nur("POST"); return konten.setzePflege(eingabe());
      case "/api/ki/pflege/jetzt": nur("POST"); return verdrahtung.jetztPflegen(v, { schalter: (p) => pflege.schalter(p), laeuft: (p) => pflege.laeuftSchon(p) });
      case "/api/ki/schutz": nur("POST"); return konten.setzeSchutz(eingabe());
      case "/api/ki/hinweis": nur("POST"); return konten.quittiereHinweis();
      // Altform (Eintrag oder Hooks ohne --konto) mit Konto neu verbinden: ändert nur die Einträge von Kortex, nie die Stufe des Kontos (das Konto wird dadurch nicht freigegeben).
      case "/api/ki/neu-verbinden": { nur("POST"); return kontoNeuVerbinden(eingabe(), v); }
      case "/api/ki/vorher": nur("POST"); return konten.holeVorher(eingabe());
      case "/api/vaults": nur("GET"); return vaultListe(v);
      case "/api/vaults/aktiv": {
        nur("POST");
        const l = vaultsFn.waehleAktiv(eingabe().pfad, optV());
        wechsleZu(l.aktiv);
        return vaultListe(aktuell);
      }
      case "/api/vaults/neu": nur("POST"); return neuerStand(await vaultsFn.neuesVault(eingabe(), optV()), "angelegt");
      case "/api/vaults/oeffnen": nur("POST"); return neuerStand(await vaultsFn.oeffneOrdner(eingabe(), optV()), "geoeffnet");
      case "/api/vaults/klonen": {
        nur("POST");
        let login = null; try { login = (await github.konto()).login || null; } catch { /* nicht angemeldet: der Klon gilt nicht als eigener */ }
        return neuerStand(await vaultsFn.klone(eingabe(), { ...optV(), githubLogin: login }), "geklont");
      }
      case "/api/vaults/entfernen": {
        nur("POST");
        const e = eingabe();
        let weg = e.pfad; try { weg = realpathSync(e.pfad); } catch { /* Ordner schon weg: Pfad wie gegeben */ }
        const l = vaultsFn.entferne(e.pfad, optV());
        if (v && weg === v.wurzel) { // der offene Vault wurde aus der Liste genommen → nächster oder Willkommen
          // Der Nachfolger ist schon gespeichert: lässt er sich nicht öffnen, ist jetzt eben kein Vault offen (200, aktiv: null — die
          // Oberfläche zeigt Willkommen). Ein 400 NACH dem Speichern ließe die Oberfläche beim entfernten Vault stehen.
          try { wechsleZu(l.aktiv); } catch { frage.brichAb("vault"); aktuell = null; }
        }
        return vaultListe(aktuell);
      }
      case "/api/github/anmelden":
        if (methode === "POST") return github.anmelden();
        nur("GET"); return github.status();
      case "/api/github/konto": nur("GET"); return github.konto();
      case "/api/github/abmelden": nur("POST"); return github.abmelden();
      case "/api/github/abbrechen": nur("POST"); return github.abbrechen(); // nur das Warten beenden, nie den Schlüsselbund anfassen
      case "/api/github/repos": nur("GET"); return github.repos(); // eigene PRIVATE Repositories (Sicherung)
      case "/api/github/repo-anlegen": nur("POST"); return github.repoAnlegen(eingabe()); // legt immer ein privates Repository an
      // Sicherung (Assistent): bereit? — und verbinden mit einem PRIVATEN Repository des Kontos (nur besitzer/name; die Adresse baut die Werkstatt).
      case "/api/sicherung/bereit": nur("GET"); return sicherungStand(await V().gitStatus());
      case "/api/sicherung/verbinden": {
        nur("POST");
        const e = eingabe();
        const stand = sicherungStand(await V().gitStatus());
        if (stand.zustand === "gesichert") throw new HttpFehler(409, "Dein Vault ist schon mit einem Server verbunden.", { art: "gesichert" });
        if (stand.zustand !== "bereit") throw new HttpFehler(409, stand.text, { art: "blockiert", grund: stand.grund });
        const repo = await github.repoPruefen(e.besitzer, e.name); // gibt es, privat, beschreibbar — sonst Fehler, bevor etwas gesendet wird
        const erg = await V().gitRemote(repo.url, { githubHelper: github.helper });
        merkeRemote(V().wurzel, repo.url);
        return erg;
      }
      case "/api/stopp": nur("POST"); frage.brichAb("ende"); return { __stopp: true };
      default: throw new HttpFehler(404, "nicht gefunden");
    }
  }

  // Vergleich NUR intern: Command/Args des vorhandenen Eintrags stehen nie in einer Antwort oder im Log (fremde Einträge können
  // Zugangsdaten enthalten). Unlesbar oder anderer Typ (http/sse) zählt als „anders“.
  // Ergebnis: "gleich" (schon richtig eingetragen), "alt" (derselbe Server in einer früheren Form — wird ohne Rückfrage auf den
  // stabilen Eintrag umgestellt) oder "anders" (fremder Eintrag: Rückfrage). Früher heißt:
  //  · der Node-Pfad war ein früherer der App: …/Application Support/Brain/node/<ver>/bin/node (vor der Umbenennung) und
  //    …/Kortex/node/<ver>/bin/node (aufgelöster Pfad), bei sonst gleichen Argumenten;
  //  · die Argumente nannten den Server im App-Paket (…/mcp/brain-mcp.mjs, auch ein früherer Kern-Ordner), dann zusätzlich nur mit
  //    dem stabilen oder einem früheren App-Node als Befehl;
  //  · die Argumente nannten einen Server unter .tools eines BEKANNTEN Vaults (<vault>/.tools/…mcp….mjs, Kit-Zeit; der Vault steht in
  //    vaults.json): sein Code läuft nicht mehr, der Eintrag wird auf den Kern umgestellt (Befehl: ein absoluter `node`). Liegt der Pfad
  //    unter einem unbekannten Ordner, ist es ein fremder Eintrag (Rückfrage).
  const ALTER_APP_NODE = /\/Application Support\/(?:Brain|Kortex)\/node\/[^/]+\/bin\/node$/;
  const ALTER_MCP_PFAD = /^\/.*\/mcp\/brain-mcp\.mjs$/;
  const ALTER_KIT_MCP = /^\/.*\/\.tools\/(?:.*\/)?[^/]*mcp[^/]*\.mjs$/;
  const imBekanntenVault = (p) => {
    const m = /^(.*)\/\.tools\//.exec(p);
    if (!m) return false;
    let liste;
    try { liste = vaultsFn.leseVaults(optV()).vaults; } catch { return false; }
    const formen = (x) => [falte(x), falte(echterPfad(x))];
    const ziel = formen(m[1]);
    return liste.some((e) => formen(e.pfad).some((f) => ziel.includes(f)));
  };
  const befehlsArt = (cmd, argsGleich, a, altArgs = null) => {
    if (argsGleich) {
      if (cmd === a[0]) return "gleich";
      return typeof cmd === "string" && ALTER_APP_NODE.test(cmd) ? "alt" : "anders";
    }
    if (typeof cmd === "string" && typeof altArgs === "string") {
      if (ALTER_MCP_PFAD.test(altArgs) && !/\/\.tools\//.test(altArgs) && (cmd === a[0] || ALTER_APP_NODE.test(cmd))) return "alt";
      if (ALTER_KIT_MCP.test(altArgs) && /^\/(?:.*\/)?node$/.test(cmd) && imBekanntenVault(altArgs)) return "alt";
    }
    return "anders";
  };
  // `--konto <id>` am Ende gehört zu Kortex: derselbe Server mit anderer oder fehlender Kennung ist ein früherer Stand desselben Eintrags ("alt"), kein fremder.
  const KONTO_ENDE = /^k_[0-9a-f]{8}$/;
  const ohneKontoListe = (l) => { const n = l.length; return n >= 2 && l[n - 2] === "--konto" && KONTO_ENDE.test(l[n - 1]) ? l.slice(0, n - 2) : l; };
  const ohneKontoText = (t) => t.replace(/ --konto k_[0-9a-f]{8}$/, "");
  const eigenerNode = (cmd, a) => typeof cmd === "string" && (cmd === a[0] || ALTER_APP_NODE.test(cmd));
  function vergleicheEintrag(command, args, a) {
    const liste = Array.isArray(args) ? args : [];
    if (JSON.stringify(liste) === JSON.stringify(a.slice(1))) return befehlsArt(command, true, a);
    if (eigenerNode(command, a) && JSON.stringify(ohneKontoListe(liste)) === JSON.stringify(ohneKontoListe(a.slice(1)))) return "alt";
    return befehlsArt(command, false, a, liste.length === 1 ? liste[0] : null);
  }
  const artClaude = (text, a) => {
    const cmd = /^\s*Command:\s*(.+?)\s*$/m.exec(text), args = /^\s*Args:\s*(.*?)\s*$/m.exec(text);
    const argsText = args ? args[1] : "";
    if (!cmd) return "anders";
    const soll = a.slice(1).join(" ");
    if (argsText === soll) return befehlsArt(cmd[1], true, a);
    if (eigenerNode(cmd[1], a) && ohneKontoText(argsText) === ohneKontoText(soll)) return "alt";
    return befehlsArt(cmd[1], false, a, argsText);
  };

  // Gesamtfrist 25 s für get/remove/add zusammen; bei Ablauf wird der laufende Aufruf samt Prozessgruppe beendet.
  // Wer ein Konto ausdrücklich verbindet, kann ihm dabei den offenen Vault freigeben: { zugriff: "gesperrt" | "lesen" | "posteingang" | "erweitert" } (der Assistent
  // fragt das). Ohne Angabe bleibt, was die Liste der KI-Konten sagt (ein neu erkanntes Konto ist gesperrt).
  async function verbinde(e, v = null) {
    const gewaehren = e.zugriff;
    if (gewaehren !== undefined && !STUFEN.includes(gewaehren)) throw new HttpFehler(400, `„zugriff“ muss eine von ${STUFEN.join(", ")} sein.`);
    let erg;
    if (e.ziel === "codex") erg = await verbindeCodex(e);
    else if (Object.hasOwn(ADAPTER, e.ziel)) erg = await ADAPTER[e.ziel].verbinde(adapterCtx(kontoFuer(e, e.ziel, { anlegen: true })), e);
    else if (e.ziel === "claude") erg = await verbindeClaude(e);
    else throw new HttpFehler(400, ZIELE_TEXT);
    if (gewaehren !== undefined) {
      const id = kontoFuer(e, e.ziel, { anlegen: true });
      let gesetzt = false;
      let grund = null;
      if (id && v) {
        try { const r = konten.setzeZugriff({ konto: id, vault: v.wurzel, stufe: gewaehren, quelle: "assistent", ausdruecklich: e.zugriffAusdruecklich === true }); gesetzt = r.zugriffGesetzt !== false; grund = r.zugriffGrund || null; }
        catch { /* z. B. ein nur für diesen Start geöffneter Vault: nicht in der Liste */ }
      }
      return { ...erg, zugriffGesetzt: gesetzt, ...(grund ? { zugriffGrund: grund } : {}) };
    }
    return erg;
  }

  async function kontoNeuVerbinden(e, v) {
    if (typeof e.konto !== "string") throw new HttpFehler(400, "Das KI-Konto muss angegeben werden.");
    const k = konten.kontoDaten(e.konto);
    if (!k) throw new HttpFehler(404, "Dieses KI-Konto gibt es nicht (mehr).");
    const alt = konten.altform(e.konto);
    const aus = { mcp: null, hooks: null };
    if (alt.mcp) aus.mcp = await verbinde({ ziel: k.programm, konto: e.konto }, null); // ohne zugriff: die Stufe bleibt, wie sie ist
    if (alt.hooks && k.programm === "claude") {
      if (!v) throw new HttpFehler(409, "Es ist noch kein Vault geöffnet.", { keinVault: true });
      aus.hooks = (await verdrahtung.verdrahte(v, { was: "claude", an: true, profile: [k.ordner] })).ok === true;
    }
    return { ok: true, ...aus, stand: konten.stand() };
  }

  // ---------- Trennen (Rückweg von „Verbinden“) ----------
  // Nimmt NUR den Eintrag „brain“ heraus, und nur, wenn er von Kortex stammt (gleich oder frühere Form). Ein fremder Eintrag unter
  // dem Namen „brain“ bleibt stehen (409, art "anders"); gibt es keinen Eintrag, ist nichts zu tun ({ ok, warNichtVerbunden }).
  // Hooks und Statuszeile bei Claude Code sind ein eigener Schalter (/api/kern/verdrahten) und bleiben unberührt.
  function trenne(e) {
    if (e.ziel === "codex") return trenneCodex(e);
    if (Object.hasOwn(ADAPTER, e.ziel)) return ADAPTER[e.ziel].trenne(adapterCtx(kontoFuer(e, e.ziel)));
    if (e.ziel !== "claude") throw new HttpFehler(400, ZIELE_TEXT);
    return trenneClaude(e);
  }

  async function trenneClaude(e) {
    const konto = kontoFuer(e, "claude");
    const a = mcpArgs(konto);
    if (!a) throw new HttpFehler(404, "Der MCP-Server wurde nicht gefunden.");
    const claude = findeClaude();
    if (!claude) throw new HttpFehler(404, "Claude Code wurde nicht gefunden.");
    const frist = neueFrist(fristen.mcpVerbinden);
    const profil = e.konto !== undefined ? profilVon(konto) : e.profil === undefined ? null : profilZuPfad(e.profil);
    if (e.profil !== undefined && e.konto === undefined && !profil) throw new HttpFehler(400, "Dieses Claude-Profil gibt es nicht (mehr). Suche die Profile bitte neu.");
    const lauf = (args) => starte(claude, args, { cwd: homedir(), env: profil ? mitProfil(kindUmgebung({ CI: "1" }), profil) : kindUmgebung({ CI: "1" }), frist, timeout: fristen.mcpVerbinden, fehlt: "Claude Code wurde nicht gefunden.", zuLange: "Claude Code hat nicht rechtzeitig geantwortet." });
    try {
      const vorher = await lauf(["mcp", "get", "brain"]);
      if (vorher.code !== 0) return { ok: true, warNichtVerbunden: true };
      const art = artClaude(String(vorher.stdout || "") + "\n" + String(vorher.stderr || ""), a);
      if (art === "anders") throw new HttpFehler(409, "Bei Claude Code steht unter dem Namen „brain“ ein anderer Eintrag, nicht der von Kortex. Kortex lässt ihn stehen.", { art: "anders" });
      const weg = await lauf(["mcp", "remove", "-s", "user", "brain"]);
      if (weg.code !== 0) throw new HttpFehler(502, "Claude Code konnte den Eintrag nicht entfernen. Führe im Terminal aus: claude mcp remove -s user brain");
      return { ok: true };
    } catch (err) {
      if (err instanceof HttpFehler && err.status === 504) throw new HttpFehler(504, "Claude Code hat nicht rechtzeitig geantwortet (nach 25 Sekunden abgebrochen). Es wurde nichts Halbes hinterlassen.");
      throw err;
    }
  }

  async function trenneCodex(e = {}) {
    const konto = kontoFuer(e, "codex");
    const a = mcpArgs(konto);
    if (!a) throw new HttpFehler(404, "Der MCP-Server wurde nicht gefunden.");
    const codex = findeProgramm("codex");
    if (!codex) throw new HttpFehler(404, "Codex wurde nicht gefunden.");
    const frist = neueFrist(fristen.mcpVerbinden);
    const lauf = (args) => starte(codex, args, { cwd: homedir(), env: mitCodexHome(kindUmgebung({ CI: "1" }), konten.kontoDaten(konto)), frist, timeout: fristen.mcpVerbinden, fehlt: "Codex wurde nicht gefunden.", zuLange: "Codex hat nicht rechtzeitig geantwortet." });
    try {
      const vorher = await lauf(["mcp", "get", "brain", "--json"]);
      if (vorher.code !== 0) return { ok: true, warNichtVerbunden: true };
      let art = "anders";
      try {
        const t = JSON.parse(String(vorher.stdout || "")).transport;
        if (t) art = vergleicheEintrag(t.command, t.args, a);
      } catch { /* bleibt "anders" */ }
      if (art === "anders") throw new HttpFehler(409, "Bei Codex steht unter dem Namen „brain“ ein anderer Eintrag, nicht der von Kortex. Kortex lässt ihn stehen.", { art: "anders" });
      const weg = await lauf(["mcp", "remove", "brain"]);
      if (weg.code !== 0) throw new HttpFehler(502, "Codex konnte den Eintrag nicht entfernen. Führe im Terminal aus: codex mcp remove brain");
      return { ok: true };
    } catch (err) {
      if (err instanceof HttpFehler && err.status === 504) throw new HttpFehler(504, "Codex hat nicht rechtzeitig geantwortet (nach 25 Sekunden abgebrochen). Es wurde nichts Halbes hinterlassen.");
      throw err;
    }
  }

  // Konfiguration zum Kopieren für andere KI-Programme: der Eintrag im üblichen Format (mcpServers → Name → command/args). Liest nur.
  // Ohne `ziel` im üblichen Format (mcpServers); mit `ziel` genau so, wie das Programm es erwartet (+ Ort der Datei).
  function konfiguration(q) {
    const ziel = q.get("ziel");
    if (ziel && !Object.hasOwn(ADAPTER, ziel)) throw new HttpFehler(400, ZIELE_TEXT);
    const ad = ziel ? ADAPTER[ziel] : ADAPTER.cursor;
    let kid = null; if (o.kontenAus !== true) { try { kid = konten.kontoFuerProgramm(ziel || "cursor"); } catch { /* ohne Kennung */ } }
    const text = ad.konfiguration(adapterCtx(kid));
    if (!text) throw new HttpFehler(404, "Der MCP-Server wurde nicht gefunden.");
    return { json: text, ...(ziel ? { ort: ad.anzeige } : {}) };
  }

  // Codex: `codex mcp get brain --json` (nur zum Vergleichen), bei fremdem Eintrag nach Rückfrage `remove`, dann `add`.
  async function verbindeCodex(e) {
    const konto = kontoFuer(e, "codex", { anlegen: true });
    const a = mcpArgs(konto), befehl = codexBefehl(konto);
    if (!a) throw new HttpFehler(404, "Der MCP-Server wurde nicht gefunden.", { befehl: null });
    const codex = findeProgramm("codex");
    if (!codex) throw new HttpFehler(404, "Codex wurde nicht gefunden. Kopiere den Befehl und führe ihn im Terminal aus.", { befehl });
    const frist = neueFrist(fristen.mcpVerbinden);
    // Ein eigenes Konto (~/.codex-*) wird über CODEX_HOME angesprochen; das Standardkonto ohne die Variable.
    const lauf = (args) => starte(codex, args, { cwd: homedir(), env: mitCodexHome(kindUmgebung({ CI: "1" }), konten.kontoDaten(konto)), frist, timeout: fristen.mcpVerbinden, fehlt: "Codex wurde nicht gefunden.", zuLange: "Codex hat nicht rechtzeitig geantwortet." });
    const ausgabeVon = (r) => (String(r.stdout || "") + String(r.stderr || "")).trim().slice(0, 2000);
    const art = (text) => { // Vergleich nur intern, nichts davon in Antworten
      try {
        const t = JSON.parse(text).transport;
        return !t ? "anders" : vergleicheEintrag(t.command, t.args, a);
      } catch { return "anders"; }
    };
    try {
      const vorher = await lauf(["mcp", "get", "brain", "--json"]);
      if (vorher.code === 0) {
        const vergleich = art(String(vorher.stdout || ""));
        if (vergleich === "gleich") return { ok: true, schonVerbunden: true };
        if (vergleich !== "alt" && e.umstellen !== true) throw new HttpFehler(409, "Bei Codex ist unter dem Namen „brain“ schon ein anderer Server eingetragen. Möchtest du ihn auf Kortex Studio umstellen?", { art: "anders", befehl });
        const weg = await lauf(["mcp", "remove", "brain"]);
        if (weg.code !== 0) throw new HttpFehler(502, "Codex konnte den alten Eintrag nicht entfernen. Kopiere den Befehl und führe ihn im Terminal aus.", { befehl });
      }
      const neu = await lauf(["mcp", "add", "brain", "--", ...a]);
      const ausgabe = ausgabeVon(neu);
      if (neu.code === 0) return { ok: true, ausgabe };
      throw new HttpFehler(502, "Codex hat den Eintrag abgelehnt. Kopiere den Befehl und führe ihn im Terminal aus.", { befehl, ausgabe });
    } catch (err) {
      if (err instanceof HttpFehler && err.status === 504) throw new HttpFehler(504, "Codex hat nicht rechtzeitig geantwortet (nach 25 Sekunden abgebrochen). Kopiere den Befehl und führe ihn im Terminal aus.", { befehl });
      throw err;
    }
  }

  async function verbindeClaude(e) {
    const konto = kontoFuer(e, "claude", { anlegen: true });
    const a = mcpArgs(konto), befehl = mcpBefehl(konto);
    if (!a) throw new HttpFehler(404, "Der MCP-Server wurde nicht gefunden.", { befehl: null });
    const claude = findeClaude();
    if (!claude) throw new HttpFehler(404, "Claude Code wurde nicht gefunden. Kopiere den Befehl und führe ihn im Terminal aus.", { befehl });
    const frist = neueFrist(fristen.mcpVerbinden);
    // Claude-Profil (Auswahl im Assistenten): nur ein erkanntes Profil; das Standardprofil nutzt ~/.claude.json, ein anderes <Profil>/.claude.json (CLAUDE_CONFIG_DIR).
    const profil = e.konto !== undefined ? profilVon(konto) : e.profil === undefined ? null : profilZuPfad(e.profil);
    if (e.profil !== undefined && e.konto === undefined && !profil) throw new HttpFehler(400, "Dieses Claude-Profil gibt es nicht (mehr). Suche die Profile bitte neu.", { befehl });
    const lauf = (args) => starte(claude, args, { cwd: homedir(), env: profil ? mitProfil(kindUmgebung({ CI: "1" }), profil) : kindUmgebung({ CI: "1" }), frist, timeout: fristen.mcpVerbinden, fehlt: "Claude Code wurde nicht gefunden.", zuLange: "Claude Code hat nicht rechtzeitig geantwortet." });
    const ausgabeVon = (r) => (String(r.stdout || "") + String(r.stderr || "")).trim().slice(0, 2000);
    try {
      const vorher = await lauf(["mcp", "get", "brain"]); // Ausgabe nur zum Vergleichen
      if (vorher.code === 0) {
        const art = artClaude(String(vorher.stdout || "") + "\n" + String(vorher.stderr || ""), a);
        if (art === "gleich") return { ok: true, schonVerbunden: true };
        if (art !== "alt" && e.umstellen !== true) throw new HttpFehler(409, "Bei Claude Code ist unter dem Namen „brain“ schon ein anderer Server eingetragen. Möchtest du ihn auf Kortex Studio umstellen?", { art: "anders", befehl });
        const weg = await lauf(["mcp", "remove", "-s", "user", "brain"]);
        if (weg.code !== 0) throw new HttpFehler(502, "Claude Code konnte den alten Eintrag nicht entfernen. Kopiere den Befehl und führe ihn im Terminal aus.", { befehl });
      }
      const neu = await lauf(["mcp", "add", "-s", "user", "brain", "--", ...a]);
      const ausgabe = ausgabeVon(neu);
      if (neu.code === 0) return { ok: true, ausgabe };
      if (/already exists/i.test(ausgabe)) throw new HttpFehler(409, "Bei Claude Code ist unter dem Namen „brain“ schon ein Server eingetragen.", { art: "anders", befehl, ausgabe });
      throw new HttpFehler(502, "Claude Code hat den Eintrag abgelehnt. Kopiere den Befehl und führe ihn im Terminal aus.", { befehl, ausgabe });
    } catch (err) {
      // 504 (nicht 409): der Server — hier Claude Code — hat nicht rechtzeitig geantwortet; es wurde nichts Halbes hinterlassen, denn jeder Aufruf
      // ist einzeln atomar und der Umstellen-Weg entfernt erst, wenn noch Zeit für den neuen Eintrag bleibt.
      if (err instanceof HttpFehler && err.status === 504) throw new HttpFehler(504, "Claude Code hat nicht rechtzeitig geantwortet (nach 25 Sekunden abgebrochen). Kopiere den Befehl und führe ihn im Terminal aus.", { befehl });
      throw err;
    }
  }

  // Probe-Frage über den MCP-Server selbst (stdio, JSON-RPC): initialize, dann tools/call brain_suchen — so, wie Claude es tun würde.
  // Der Server wird OHNE Vault-Argument gestartet und folgt dem aktiven Vault aus vaults.json (derselbe Support-Ordner wie wir).
  // Gesamtfrist 10 s; danach (oder nach der Antwort) wird die Prozessgruppe beendet.
  async function probeUeberMcp(v, frage, anzahl, { liste = false, wer = "Claude" } = {}) {
    const a = mcpArgs();
    if (!a) throw new HttpFehler(404, "Der MCP-Server wurde nicht gefunden.");
    let aktivPfad = null; try { aktivPfad = vaultsFn.aktiverVaultPfad(optV()); } catch { /* keine Liste */ }
    if (!aktivPfad || echterPfad(aktivPfad) !== v.wurzel) {
      throw new HttpFehler(409, `Dieser Vault ist in Kortex Studio nicht als aktiver Vault eingetragen — ${wer} würde ihn so nicht finden. Wähle ihn zuerst aus.`, { art: "nicht-aktiv" });
    }
    // KI-Konten: Der Server prüft bei jedem Aufruf das Konto. Gibt es die Liste, läuft die Probe als ein Konto, das den Vault lesen darf (claude zuerst);
    // darf keines, wäre „nichts gefunden“ irreführend — die KI würde den Vault so ja auch nicht sehen.
    const pk = konten.probeKonto(v.wurzel);
    if (pk.liste && !pk.konto) throw new HttpFehler(409, `Kein KI-Konto darf diesen Vault lesen — ${wer} würde ihn so nicht finden. Gib ihn unter „KI-Konten“ frei.`, { art: "kein-zugriff" });
    const pkDaten = pk.konto ? konten.kontoDaten(pk.konto) : null;
    const env0 = kindUmgebung({ BRAIN_APP_SUPPORT: vaultOpt.support || supportOrdner(), BRAIN_NUTZUNG: "aus" }); // Probe und Selbsttest sind keine KI-Nutzung
    delete env0.BRAIN_VAULT;
    // die Umgebung des Kontos nachbilden (nie die der Werkstatt erben: ein fremdes CLAUDE_CONFIG_DIR widerspräche dem Konto)
    const env = mitCodexHome(mitProfil(env0, pkDaten && pkDaten.programm === "claude" ? { pfad: pkDaten.ordner, standard: pkDaten.standard === true } : null), pkDaten);
    const frist = neueFrist(fristen.probe);
    const nachricht = (m) => JSON.stringify({ jsonrpc: "2.0", ...m }) + "\n";
    return new Promise((ok, nein) => {
      let kind, uhr = null, fertig = false, werkzeuge = null, suche = null;
      // fertig, sobald die Suche (und beim Selbsttest auch die Werkzeugliste) geantwortet hat
      const pruefe = () => {
        if (!suche || (liste && !werkzeuge)) return;
        const r = suche.result;
        const text = r && Array.isArray(r.content) ? r.content.map((c) => (c && typeof c.text === "string" ? c.text : "")).join("\n") : "";
        if (suche.error || !r || r.isError) return ende(new HttpFehler(502, text || "Der MCP-Server konnte die Suche nicht ausführen.", { art: "mcp" }));
        const treffer = r._meta && Array.isArray(r._meta["brain-studio/treffer"]) ? r._meta["brain-studio/treffer"] : [];
        ende(null, liste ? { ok: true, werkzeuge, treffer: treffer.length } : { frage, treffer, text });
      };
      const ende = (fehler, wert) => {
        if (fertig) return;
        fertig = true; clearTimeout(uhr);
        beendeGruppe(kind);
        if (fehler) nein(fehler); else ok(wert);
      };
      try { kind = spawn(a[0], [a[1], ...(pk.konto ? ["--konto", pk.konto] : [])], { cwd: homedir(), env, detached: true, stdio: ["pipe", "pipe", "ignore"], windowsHide: true }); }
      catch { return nein(new HttpFehler(502, "Der MCP-Server ließ sich nicht starten.", { art: "mcp" })); }
      registriere(kind, null);
      const nichtAntwort = () => ende(new HttpFehler(502, `Der MCP-Server hat nicht geantwortet — ${wer} würde deinen Vault so nicht finden.`, { art: "mcp" }));
      kind.on("error", nichtAntwort);
      kind.stdin.on("error", () => { /* Server schon weg */ });
      kind.on("exit", () => setTimeout(nichtAntwort, 300).unref());
      uhr = setTimeout(() => ende(new HttpFehler(504, "Der MCP-Server hat nicht rechtzeitig geantwortet (nach 10 Sekunden abgebrochen).", { art: "mcp" })), Math.max(1, frist.rest()));
      createInterface({ input: kind.stdout, crlfDelay: Infinity }).on("line", (zeile) => {
        let m; try { m = JSON.parse(zeile); } catch { return; }
        if (!m || m.jsonrpc !== "2.0") return;
        if (m.id === 1) {
          if (m.error || !m.result) return nichtAntwort();
          kind.stdin.write(nachricht({ method: "notifications/initialized" }));
          if (liste) kind.stdin.write(nachricht({ id: 3, method: "tools/list" }));
          kind.stdin.write(nachricht({ id: 2, method: "tools/call", params: { name: "brain_suchen", arguments: { frage, ...(anzahl ? { anzahl } : {}) } } }));
        } else if (m.id === 3) {
          const t = m.result && Array.isArray(m.result.tools) ? m.result.tools.map((x) => x && x.name).filter((x) => typeof x === "string") : null;
          if (!t || !t.includes("brain_suchen")) return ende(new HttpFehler(502, "Der MCP-Server meldet keine Suche (brain_suchen) — das Werkzeug fehlt.", { art: "mcp" }));
          werkzeuge = t; pruefe();
        } else if (m.id === 2) { suche = m; pruefe(); }
      });
      kind.stdin.write(nachricht({ id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "brain-studio-probe", version: appVersion } } }));
    });
  }

  async function behandle({ methode = "GET", pfad = "/", query, body }) {
    methode = String(methode).toUpperCase();
    if (!pfad.startsWith("/api/") && pfad !== "/api") {
      if (methode !== "GET" && methode !== "HEAD") return fehler(405, "Diese Methode ist hier nicht erlaubt.");
      return statisch(pfad, studioDir);
    }
    const q = query instanceof URLSearchParams ? query : new URLSearchParams(query || "");
    const v = aktuell; // dieser Vault gilt für die ganze Anfrage, auch wenn währenddessen gewechselt wird
    // Schreibende Anfragen der Oberfläche sind keine „externen Änderungen“: Die Meldung wartet, bis die Anfrage fertig ist, und die berührten Dateien gelten als eigen.
    const schreibt = methode !== "GET" && methode !== "HEAD";
    if (schreibt) ereignisse.beginneEigenes();
    let eigen = [], eigenKopf = false;
    try {
      const erg = await api(methode, pfad, q, body, v);
      if (schreibt) { eigen = eigenePfade(pfad, body, erg); eigenKopf = /^\/api\/(git|posteingang|sicherung|vaults|umstellung)\//.test(pfad); }
      if (erg && erg.__stopp) return { ...json(200, { ok: true }), stopp: true };
      return json(200, erg === undefined ? { ok: true } : erg);
    } catch (e) {
      if (schreibt) eigen = eigenePfade(pfad, body, null);
      if (e instanceof HttpFehler) return fehler(e.status, e.message, e.extra);
      return fehler(500, "Interner Fehler");
    } finally {
      if (schreibt) ereignisse.endeEigenes(eigen, { kopf: eigenKopf });
      else if (/^\/api\/ki\/konten\/?$/.test(pfad)) ereignisse.markiereEigen(["@support/ki-konten.json"]); // der Abgleich beim Abruf schreibt die Liste selbst
    }
  }
  // Welche Dateien hat diese schreibende Anfrage (vermutlich) angefasst? Vault-relative Pfade aus Anfrage und Antwort, dazu die Dateien im Benutzerordner.
  function eigenePfade(pfad, body, erg) {
    const k = new Set();
    const rel = (x) => { if (typeof x === "string" && x && !x.startsWith("/") && !x.includes("..") && x.length < 1000) k.add(x); };
    let e = null;
    try { e = body && body.length ? JSON.parse(body.toString("utf8")) : null; } catch { e = null; }
    if (pfad.startsWith("/api/aufgaben/")) { try { rel(decodeURIComponent(pfad.slice("/api/aufgaben/".length))); } catch { /* ungültig */ } }
    if (e && typeof e === "object") { rel(e.pfad); rel(e.ziel); if (e.platz && typeof e.platz === "object") { rel(e.platz.davor); rel(e.platz.danach); } }
    if (erg && typeof erg === "object") { rel(erg.pfad); rel(erg.ziel); if (Array.isArray(erg.geaendert)) erg.geaendert.forEach(rel); if (Array.isArray(erg.archiviert)) for (const x of erg.archiviert) { rel(x?.von); rel(x?.pfad); } }
    if (pfad === "/api/einstellungen") { k.add("brain.config.json"); k.add("@support/einstellungen.json"); k.add("AGENTS.md"); }
    if (/^\/api\/vertrauen\/?$/.test(pfad) || pfad.startsWith("/api/vaults")) k.add("@support/vertrauen.json");
    if (/^\/api\/(ki|mcp)\//.test(pfad) || pfad.startsWith("/api/vaults")) k.add("@support/ki-konten.json");
    return [...k];
  }
  behandle.aktuellerVaultPfad = () => (aktuell ? aktuell.wurzel : null);
  behandle.konten = konten; // werkstatt.mjs gleicht die Liste beim Start ab
  behandle.migrierePflege = () => migrierePflege(aktuell, { start: true }); // und übernimmt danach einmal das alte Profil der plist in die Pflege-Einstellung
  behandle.ereignisse = ereignisse; // werkstatt.mjs beendet wartende Abrufe, bevor es sich schließt
  return behandle;
}
