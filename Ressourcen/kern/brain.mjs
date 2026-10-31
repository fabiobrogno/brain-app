#!/usr/bin/env node
// brain.mjs — ein Einstieg für alle Agenten und Menschen. Kein Agent-spezifischer Code hier.
// Befehle: index | search "<frage>" [n] | lint | ingest-check <datei> | refresh | hooks-install | claude-hooks | version | pflege | messlatte | status [--json]
//   | lernschleife | antworten | wirkung | tageslauf | rueckfragen | zurueck | traum | dienst | nachernte | gedaechtnis | gesundheit
//   | aufgabe neu|erledigt|status|archivieren | aufgaben | abgleich ansicht|loesen|abbrechen|rueckgaengig
// Skill-Helfer (statt POSIX-Shell, laufen gleich auf macOS/Windows/Linux): lock | unlock | sha <datei> | jetzt | review-erledigt
// Exit-Codes: 0 ok, 2 Befunde (lint) / unbekannte Option (zeig), 3 Secrets (ingest-check), 64 falscher Aufruf.
import { execFileSync, spawnSync, spawn } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, statSync, rmSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { vaultPfad, pruefeVault, KeinVaultFehler, ladeConfig, kernVersion, angegebenerVaultPfad, angegebenesKonto, vaultVertraut, NICHT_VERTRAUT_TEXT } from "./pfade.mjs";
import { findeSecrets } from "./secrets-muster.mjs";
import { minisuche } from "./minisuche.mjs";
import { qmdAufruf } from "./qmd-befehl.mjs";
import { parseQmdDateien } from "./qmd-ausgabe.mjs";
import { oeffnerAufruf } from "./oeffner.mjs";
import { merkeLuecke } from "./analyse.mjs";

const T = dirname(fileURLToPath(import.meta.url));
const [befehl, ...rest] = process.argv.slice(2);
// Kein Positions-Vault: brain.mjs bekommt Unterbefehl + dessen Argumente, keinen Vault-Pfad — der Vault kommt aus --vault <pfad>
// (pfade.mjs nimmt es aus der Kommandozeile), BRAIN_VAULT oder dem aktiven Vault der App (Positionsargumente gehen an die Werkzeuge in index/lint/refresh).
// Ohne Vault laufen nur die Befehle, die keinen brauchen; alle anderen enden mit Exit 2 und einer klaren Meldung.
const OHNE_VAULT = new Set(["version", "jetzt", "sha", "ingest-check", "claude-hooks", "umstellung"]);
let vault = null, vaultFehler = null;
try { vault = vaultPfad(["", ""]); } catch (e) { if (!(e instanceof KeinVaultFehler)) throw e; vaultFehler = e; }
// Der Konflikt-Abgleich des Studios braucht keine brain.config.json (auch ein Ordner mit Versionsverlauf lässt sich zusammenführen)
if (!vault && befehl === "abgleich" && angegebenerVaultPfad()) { try { vault = pruefeVault(angegebenerVaultPfad(), { ohneConfig: true }); vaultFehler = null; } catch (e) { if (!(e instanceof KeinVaultFehler)) throw e; vaultFehler = e; } }
const b = qmdAufruf();

const node = (skript, ...a) => spawnSync(process.execPath, [join(T, skript), ...a], { stdio: "inherit", windowsHide: true }).status ?? 1;
const hatQmd = () => { const r = spawnSync(b.cmd, [...b.vorArgs, "--help"], { stdio: "ignore", windowsHide: true }); return !r.error && r.status === 0; };

function suche(frage, n = "5") {
  if (!frage) { console.error("Nutzung: brain search \"<frage>\" [anzahl]"); return 64; }
  let profil = ladeConfig(vault).suche?.profil || "leicht";
  // Im KI-Lauf (BRAIN_ERNTE=1, z. B. Sonnet der Pflege in einer Arbeitskopie) nie den qmd-Index fragen: er gehört zum ECHTEN Vault
  // und kennt Seiten, die der Themen-Guard der Kopie ausgeschlossen hat. Die einfache Suche liest nur den Vault des Aufrufs.
  if (process.env.BRAIN_ERNTE === "1") profil = "minimal";
  if (profil !== "minimal" && !hatQmd()) {
    console.error("Hinweis: Die bessere Suche ist noch nicht installiert — ich nutze die einfache Suche.");
    profil = "minimal";
  }
  if (profil === "minimal") {
    const treffer = minisuche(vault, frage, Number(n));
    treffer.forEach(t => console.log(`${t.score.toFixed(4)},${t.pfad}`));
    if (!treffer.length) merkeLuecke(vault, "search", frage);
    return 0;
  }
  const lauf = (art) => {
    try {
      return execFileSync(b.cmd, [...b.vorArgs, art, frage, "-c", "brain", "-n", n, "--files"], {
        encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true,
      });
    } catch { return ""; }
  };
  if (profil === "voll") {
    const treffer = parseQmdDateien(lauf("query")).slice(0, Number(n));
    treffer.forEach(t => console.log(`${t.score.toFixed(4)},${t.pfad}`));
    if (!treffer.length) merkeLuecke(vault, "search", frage);
    return 0;
  }
  // leicht: BM25 + Vektor, per Reciprocal Rank Fusion gemischt, ohne LLM-Reranker.
  const rang = new Map();
  for (const art of ["search", "vsearch"]) {
    parseQmdDateien(lauf(art)).forEach((t, i) => {
      rang.set(t.pfad, (rang.get(t.pfad) || 0) + 1 / (60 + i));
    });
  }
  const sortiert = [...rang].sort((a, b) => b[1] - a[1]).slice(0, Number(n));
  sortiert.forEach(([p, s]) => console.log(`${s.toFixed(4)},${p}`));
  if (!sortiert.length) merkeLuecke(vault, "search", frage);
  return 0;
}

// Öffnet eine Datei im Standardprogramm des Systems (Browser bei .html) — detached + unref, damit
// brain.mjs sich nicht am geöffneten Programm festhält. Der Rückgabewert des Aufrufs selbst beweist noch
// keinen Erfolg: ein fehlendes Öffner-Programm (z. B. xdg-open ohne Desktop-Umgebung) wirft NICHT synchron,
// das ENOENT kommt ausschließlich asynchron über das "error"-Event — darum hier auf "spawn" (Erfolg) bzw.
// "error" (Scheitern) warten, mit kurzem Timeout-Fallback als Kompromiss zwischen Robustheit und der
// Forderung, den Prozess nicht unnötig am Leben zu halten (keins der beiden Events kommt rechtzeitig →
// optimistisch true). BRAIN_OEFFNER: reiner Testhaken, ersetzt das Öffner-Programm (z. B. durch einen
// garantiert nicht existierenden Pfad), damit Tests den Scheitern-Pfad auslösen können, ohne einen echten
// Browser zu öffnen.
// Welches Programm mit welchen Argumenten: oeffner.mjs (Windows über rundll32 statt explorer.exe).
// Für den Ansicht-Dienst wird statt einer Datei eine http-Adresse geöffnet: dann ist `datei` die Adresse selbst.
function oeffneDatei(datei, timeoutMs = 250, url = pathToFileURL(datei).href) {
  const { cmd, args } = oeffnerAufruf({ datei, url }, process.platform, process.env.BRAIN_OEFFNER || "");
  return new Promise((resolve) => {
    let entschieden = false;
    const entscheide = (ok) => { if (entschieden) return; entschieden = true; clearTimeout(timer); resolve(ok); };
    let kind;
    try { kind = spawn(cmd, args, { detached: true, stdio: "ignore", windowsHide: true }); }
    catch { entscheide(false); return; }
    kind.on("spawn", () => entscheide(true));
    kind.on("error", () => entscheide(false));
    const timer = setTimeout(() => entscheide(true), timeoutMs);
    kind.unref();
  });
}

// „brain zeig" — erzeugt die Daten für die 3D-Ansicht (ansicht/daten.mjs im Kern) und öffnet sie im Browser:
// über den lokalen Ansicht-Dienst (ansicht/dienst-start.mjs, http://127.0.0.1:<port>, Token nur im
// URL-Fragment), sonst — Start gescheitert — als file://-Ansicht: <vault>/.logs/ansicht/seite.html (eine Kopie von ansicht/index.html
// mit <base> auf den Kern und der Adresse der Daten; der Kern selbst liegt außerhalb des Vaults und bleibt unverändert).
// --nur-daten: nur erzeugen, nichts öffnen, Seitenzahl drucken.
// --nicht-oeffnen: erzeugen, file://-Pfad drucken, aber nicht öffnen und keinen Dienst starten (Tests/Skripte).
// --stopp: laufenden Ansicht-Dienst dieses Vaults beenden.
async function zeig(...args) {
  const bekannt = new Set(["--nur-daten", "--nicht-oeffnen", "--stopp"]);
  const unbekannt = args.filter(a => !bekannt.has(a));
  if (unbekannt.length) {
    console.error(`Unbekannte Option: ${unbekannt.join(", ")} — erlaubt: --nur-daten, --nicht-oeffnen, --stopp`);
    return 2;
  }
  const nurDaten = args.includes("--nur-daten");
  const nichtOeffnen = nurDaten || args.includes("--nicht-oeffnen");
  if (!existsSync(vault)) { console.error(`Vault nicht gefunden: ${vault}`); return 1; }
  const startModul = join(T, "ansicht", "dienst-start.mjs");
  if (args.includes("--stopp")) {
    let gestoppt = false;
    try { if (existsSync(startModul)) gestoppt = await (await import(pathToFileURL(startModul).href)).stoppe(vault); }
    catch { /* nichts zu stoppen */ }
    console.log(gestoppt ? "Ansicht-Dienst beendet." : "Es lief kein Ansicht-Dienst.");
    return 0;
  }
  // Über den Dienst holt die Seite ihre Daten per /api/daten; im file://-Rückfall lädt die Seite <vault>/.logs/ansicht/data.js (Adresse steht in seite.html).
  const modulPfad = join(T, "ansicht", "daten.mjs");
  const quellIndex = join(T, "ansicht", "index.html");
  if (!existsSync(modulPfad) || !existsSync(quellIndex)) {
    console.error("Die 3D-Ansicht fehlt in diesem Kern — aktualisiere Kortex.");
    return 1;
  }
  const indexPfad = join(vault, ".logs", "ansicht", "seite.html");
  let erg;
  try {
    const { erzeugeAnsichtsDaten } = await import(pathToFileURL(modulPfad).href);
    erg = erzeugeAnsichtsDaten(vault);
  } catch (e) {
    console.error(String(e?.message || e).split("\n")[0]);
    return 1;
  }
  for (const w of erg.warnungen || []) console.error(`Warnung: ${w}`);
  if (nurDaten) { console.log(`${erg.seiten} Seiten, ${erg.verbindungen} Verbindungen.`); return 0; }
  schreibeDateiSeite(vault, quellIndex, indexPfad);
  const url = pathToFileURL(indexPfad).href;
  if (nichtOeffnen) { console.log(`Öffne diese Datei im Browser: ${url}`); return 0; }
  // Ansicht-Dienst: läuft einer für diesen Vault, wird er wiederverwendet, sonst gestartet. Der Token steht nur
  // in der geöffneten Adresse (Fragment) — in der Ausgabe (landet bei der KI/im Terminal) nur ohne ihn.
  let dienst = null;
  try { if (existsSync(startModul)) dienst = await (await import(pathToFileURL(startModul).href)).starteOderFinde(vault); }
  catch { dienst = null; }
  if (dienst) {
    const ohneSchluessel = dienst.url.replace(/#.*$/, "");
    const ok = await oeffneDatei(dienst.url, 250, dienst.url);
    // Auch wenn das Öffnen scheitert: den Schlüssel nie ausgeben (die Ausgabe landet im KI-Verlauf).
    console.log(ok ? `Geöffnet im Browser: ${ohneSchluessel}`
      : `Öffne diese Adresse im Browser: ${ohneSchluessel} — den Schlüssel dafür (#t=…) findest du in .logs/ansicht/dienst.json.`);
    return 0;
  }
  console.error("Hinweis: Der Ansicht-Dienst ließ sich nicht starten — ich öffne die einfache Ansicht (Ansehen geht, Einstellungen ändern nicht).");
  const ok = await oeffneDatei(indexPfad);
  console.log(ok ? `Geöffnet im Browser: ${url}` : `Öffne diese Datei im Browser: ${url}`);
  return 0;
}

// file://-Rückfall der Ansicht: index.html mit <base> auf den Kern-Ordner und der Adresse der Daten im Vault (app.js liest meta brain-daten).
function schreibeDateiSeite(vaultPfad_, quelle, ziel) {
  const basis = pathToFileURL(join(T, "ansicht") + sep).href;
  const daten = pathToFileURL(join(vaultPfad_, ".logs", "ansicht", "data.js")).href;
  const html = readFileSync(quelle, "utf8").replace("<head>", `<head>\n<base href="${basis}">\n<meta name="brain-daten" content="${daten}">`);
  mkdirSync(dirname(ziel), { recursive: true });
  writeFileSync(ziel, html);
}

// Lokale Zeit als „YYYY-MM-DD HH:MM" (für _log.md, Lock, Review-Marke) — nie schätzen.
function jetzt(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
const lockPfad = () => join(vault, ".logs", "ingest.lock");
const LOCK_MIN = 30;

// Roh-Text (aus "schluessel=wert") in den Typ wandeln, den einstellungen.mjs#SCHEMA für diesen Schlüssel
// erwartet — "null" löscht IMMER (Rückfall auf Standard), ein unbekannter Schlüssel kommt unverändert durch
// (schreibeAutomatik meldet das gleich selbst in Alltagssprache). Ungültige Werte (z. B. "vielleicht" bei
// einem boolean) kommen ebenfalls unverändert durch — auch das meldet schreibeAutomatik verständlich.
function parseEinstellungsWert(schema, roh) {
  if (roh === "null") return null;
  if (!schema) return roh;
  if (schema.typ === "boolean") return roh === "true" ? true : roh === "false" ? false : roh;
  // Ganze Zahl (einschwingen): nur reine Ziffern werden zur Zahl; alles andere kommt unverändert durch und wird von schreibeAutomatik abgelehnt.
  if (schema.typ === "ganzzahl") return /^\d{1,6}$/.test(roh.trim()) ? Number(roh.trim()) : roh;
  // Pfadliste (Final-Review #7): Pfade dürfen Kommas enthalten („C:\\Users\\Müller, Anna\\Firma") — darum
  // getrennt durch ";" oder Zeilenumbruch, oder als JSON-Liste '["…", "…"]'. Anhängen: ernteNichtIn+=<pfad>.
  if (schema.typ === "pfadliste") {
    if (roh.trim().startsWith("[")) { try { const l = JSON.parse(roh); if (Array.isArray(l)) return l; } catch {} return roh; }
    return roh.split(/[;\r\n]+/).map(s => s.trim()).filter(Boolean);
  }
  // Wortliste (Themen-Ausschluss, ernteOhneThema): getrennt durch ";", Komma oder Zeilenumbruch, Leerzeichen im Begriff bleiben
  // („weißes zebra“); ein Wort mit Komma geht als JSON-Liste '["a, b"]'. Anhängen: ernteOhneThema+=<wort>.
  if (schema.typ === "wortliste") {
    if (roh.trim().startsWith("[")) { try { const l = JSON.parse(roh); if (Array.isArray(l)) return l; } catch {} return roh; }
    return roh.split(/[;,\r\n]+/).map(s => s.trim()).filter(Boolean);
  }
  // Namensliste (Werkzeugnamen, z. B. mcpVertraut): ein Name hat weder Leerzeichen noch Komma oder Semikolon.
  if (schema.typ === "namensliste") {
    if (roh.trim().startsWith("[")) { try { const l = JSON.parse(roh); if (Array.isArray(l)) return l; } catch {} return roh; }
    return roh.split(/[;,\s]+/).filter(Boolean);
  }
  if (schema.werte && schema.werte.every(w => typeof w === "number")) return Number(roh);
  return roh;
}

// Optionen der Form „--name wert“ (Liste `mitWert`) und „--name“ (Schalter) von den übrigen Wörtern trennen.
function leseOptionen(args, mitWert = []) {
  const pos = [], opt = {};
  for (let i = 0; i < args.length; i++) {
    const m = /^--([a-z-]+)(?:=(.*))?$/s.exec(args[i]);
    if (!m) { pos.push(args[i]); continue; }
    if (mitWert.includes(m[1])) opt[m[1]] = m[2] !== undefined ? m[2] : (args[++i] ?? "");
    else opt[m[1]] = true;
  }
  return { pos, opt };
}

const befehle = {
  jetzt: () => (console.log(jetzt()), 0),
  // Lock für Wiki-Änderungen (Riegel-Hook verlangt ihn). Ein frischer fremder Lock (< 30 min) heißt: eine
  // andere Sitzung arbeitet gerade → nicht überschreiben, Exit 1. Ein alter Lock gilt als liegengeblieben.
  lock: () => {
    mkdirSync(join(vault, ".logs"), { recursive: true });
    try { writeFileSync(lockPfad(), jetzt() + "\n", { flag: "wx" }); console.log("Lock gesetzt."); return 0; }
    catch (e) { if (e.code !== "EEXIST") throw e; }
    const alterMin = (Date.now() - statSync(lockPfad()).mtimeMs) / 60000;
    if (alterMin < LOCK_MIN) {
      console.log(`Eine andere Sitzung arbeitet gerade am Wiki (seit ${Math.floor(alterMin)} min) — bitte später erneut versuchen.`);
      return 1;
    }
    writeFileSync(lockPfad(), jetzt() + "\n");
    console.log("Lock gesetzt (alter Lock war liegengeblieben).");
    return 0;
  },
  // Review-Marke (mtime zählt: Sitzungsstart/Lint melden „Review fällig" nach 30 Tagen).
  "review-erledigt": () => { mkdirSync(join(vault, ".logs"), { recursive: true }); writeFileSync(join(vault, ".logs", "letzter-review"), jetzt() + "\n"); console.log("Review vermerkt."); return 0; },
  unlock: () => { rmSync(lockPfad(), { force: true }); console.log("Lock entfernt."); return 0; },
  // Erste 16 Hex-Zeichen des SHA-256 einer Datei (Beweisbindung quellen_sha).
  sha: (datei) => {
    if (!datei) { console.error("Nutzung: brain sha <datei>"); return 64; }
    let inhalt;
    try { inhalt = readFileSync(datei); } catch { console.error(`Datei nicht gefunden: ${datei}`); return 64; }
    console.log(createHash("sha256").update(inhalt).digest("hex").slice(0, 16));
    return 0;
  },
  version: () => (console.log(kernVersion()), 0),
  index: () => node("brain-index.mjs", vault),
  lint: () => node("brain-lint.mjs", vault),
  refresh: () => {
    // Refresh baut den qmd-Index/Embeddings neu — ohne qmd kein Fehlschlag: Hinweis auf stderr,
    // dann an search-refresh.mjs delegieren (das bricht intern still ab und beendet sich immer mit 0).
    if (!hatQmd()) console.error("Hinweis: Die bessere Suche ist nicht installiert — der Suchindex wird nicht aufgefrischt. Die einfache Suche funktioniert trotzdem.");
    return node("search-refresh.mjs", vault);
  },
  // „brain hooks-install [--aus|--stand|--ersetzen]" — core.hooksPath des Vaults auf die Hooks des Kerns (stabiler Pfad); --aus nimmt ihn wieder heraus.
  "hooks-install": (...a) => node("install-git-hooks.mjs", vault, ...a),
  // „brain claude-hooks [--entfernen|--stand] [--claude-home <ordner>]" — Hooks, Statuszeile und Brain-Befehle in Claude Code eintragen bzw. entfernen.
  "claude-hooks": (...a) => node(join("adapters", "claude-code", "install.mjs"), ...(vault ? [vault] : []), ...a, ...(angegebenesKonto() ? ["--konto", angegebenesKonto()] : [])), // --konto nimmt pfade.mjs aus process.argv: hier wieder anhängen
  // „brain umstellung befund [--json] [--claude-home <ordner>]…“ — Befund für Vaults aus der Kit-Zeit (umstellung/, nur lesend). Beschreibt auch einen Vault, den pruefeVault ablehnt.
  umstellung: (...a) => node(join("umstellung", "cli.mjs"), vault || angegebenerVaultPfad() || process.env.BRAIN_VAULT || "", ...a),
  doctor: () => node("doctor.mjs", vault),
  // Gesamtzustand (✓/⚠/✕) — für Menschen als Text, für die Brain-App als genau eine JSON-Zeile (--json).
  status: async (...a) => {
    const { brainStatus, statusText } = await import("./status.mjs");
    const s = await brainStatus(vault);
    console.log(a.includes("--json") ? JSON.stringify(s) : statusText(s));
    return 0;
  },
  "ingest-check": (datei) => {
    if (!datei) { console.error("Nutzung: brain ingest-check <datei>"); return 64; }
    let text;
    try { text = readFileSync(datei, "utf8"); }
    catch { console.error(`Datei nicht gefunden: ${datei}`); return 64; }
    const f = findeSecrets(text);
    if (!f.length) return 0;
    console.log("SECRETS GEFUNDEN (nur Fundstellen):");
    f.forEach(t => console.log(`Zeile ${t.zeile}`));
    return 3;
  },
  search: suche,
  zeig,
  // „brain analyse [--json]" — delegiert ans Analyse-Werkzeug (Task 5): gleiche Kennzahlen/Text wie
  // `node analyse.mjs`, nur über den gewohnten Einstiegspunkt aufrufbar (auch für KIs ohne Ansicht).
  analyse: (...a) => node("analyse.mjs", vault, ...a),
  // „brain pflege [--json]" — Pflegebericht (v0.4, pflege.mjs): was zu tun ist, je Posten mit nächstem Schritt.
  pflege: (...a) => node("pflege.mjs", vault, ...a),
  // „brain messlatte [--json]" — lokaler Such-Eval (v0.4, messlatte.mjs), Ergebnis in .logs/hint-eval.log.
  messlatte: (...a) => node("messlatte.mjs", vault, ...a),
  // „brain gesundheit [--json] [--trocken] [--messlatte]" — Gesundheits-Wächter (tageslauf/gesundheit.mjs, 0 Tokens): Messlatte, Hinweis-Wege, Suchindex,
  // Suchdienst, Rückstand. Speichert den Stand (--trocken: nicht), --messlatte misst jetzt (Minuten). Exit 0 = grün, 2 = Warnungen.
  gesundheit: (...a) => node(join("tageslauf", "gesundheit.mjs"), vault, ...a),
  // „brain lernschleife [--woche] [--json]" — Kandidaten „Frage → Seite“ (0 Tokens); --woche schreibt die Vorschläge.
  lernschleife: (...a) => node("lernschleife.mjs", vault, ...a),
  // „brain antworten" — Antwort-Messlatte von Hand (Haiku, kostet Tokens; Testfragen in <wiki>/_antworten.json).
  antworten: (...a) => node("antwort-messlatte.mjs", vault, ...a),
  // „brain wirkung [--tage=30] [--bis=JJJJ-MM-TT] [--json] [--speichern]" — K15 Alltags-Wirkung (0 Tokens, speichert nur Zahlen).
  wirkung: (...a) => node("wirkung.mjs", vault, ...a),
  // B2 Lernkreislauf (Spec 2026-10-21 §5): „brain tageslauf [--wenn-faellig] [--probe] [--nur-antworten] [--losgeloest]",
  // „brain rueckfragen [liste|antwort <id> <wahl> [notiz]]", „brain zurueck <lauf|id>", „brain dienst an|aus|status".
  tageslauf: (...a) => node("tageslauf.mjs", vault, ...a),
  rueckfragen: (...a) => node("rueckfragen.mjs", vault, ...a),
  zurueck: (...a) => node(join("tageslauf", "zurueck.mjs"), vault, ...a),
  // „brain traum [--probe] [--projekt <schlüssel>]" — der Traum (Pflege des Claude-Gedächtnisses) von Hand; Rückfragen nur bei traum=an, sonst Probe.
  traum: (...a) => node(join("tageslauf", "traum.mjs"), vault, ...a),
  dienst: (...a) => node(join("tageslauf", "dienst.mjs"), vault, ...a),
  // „brain nachernte [--budget-aufrufe N] [--zaehlen]" — alle gesicherten Transkripte mit dem schärferen Auftrag noch einmal ernten
  // (Haiku, kostet Tokens; je Sitzung ein Aufruf, Standard 60 je Lauf, erledigte Sitzungen werden übersprungen).
  nachernte: (...a) => node("nachernte.mjs", vault, ...a),
  // „brain gedaechtnis [status|abgleichen] [--projekt <P>] [--anwenden] [--json]" — gemeinsames Auto-Memory für mehrere Claude-Konten (gedaechtnis.mjs):
  // 3-Wege-Abgleich über eine Wurzel, jedes Konto behält echte Ordner. Trockenlauf ist der Standard, --anwenden führt aus (Sicherung als .tgz, Wurzel als lokales Git-Repo).
  gedaechtnis: (...a) => node("gedaechtnis.mjs", vault, ...a),
  // „brain import <ordner|zip> [--name x] [--ja]" — delegiert ans Import-Werkzeug (Task 7); fehlt die Quelle,
  // meldet brain.mjs selbst die vertraute Nutzung statt des Skript-internen Aufrufs.
  // „brain import fertig <quelle> <paket|--alle> --ziel <cluster>" — Paket als eingearbeitet abschließen
  // (Dateien in den Cluster verschieben, Fortschritt im Bericht; import/abschluss.mjs).
  import: (quelle, ...a) => {
    if (!quelle) { console.error("Nutzung: brain import <ordner|zip> [--name x] [--ja] | brain import fertig <quelle> <paket|--alle> --ziel <cluster>"); return 64; }
    if (quelle === "fertig") return node(join("import", "abschluss.mjs"), vault, ...a);
    return node(join("import", "import.mjs"), quelle, vault, ...a);
  },
  // „brain einstellungen [schluessel=wert …]" — dasselbe Schema wie die Maske (Task 0: SCHEMA/leseAutomatik/
  // schreibeAutomatik), nur als Zeile für KIs ohne Ansicht. Ohne Argumente: aktuelle Werte auflisten.
  // "<schluessel>=null" löscht den Schlüssel (Rückfall auf Standard). Ungültige/unbekannte Schlüssel und
  // Schreibkonflikte (409) wirft schreibeAutomatik bereits mit einer Alltags-Fehlermeldung — die fängt der
  // äußere catch (ganz unten in dieser Datei) ab und druckt sie unverändert.
  einstellungen: async (...args) => {
    const { SCHEMA, leseAutomatik, schreibeAutomatik, rendereAgentsDatei } = await import("./einstellungen.mjs");
    const { werte, stand } = leseAutomatik(vault);
    if (!args.length) {
      for (const [k, v] of Object.entries(werte)) console.log(`${k}=${JSON.stringify(v)}`);
      return 0;
    }
    const neu = {};
    for (const stueck of args) {
      const i = stueck.indexOf("=");
      if (i < 0) { console.error(`Nutzung: brain einstellungen schluessel=wert … (ungültig: "${stueck}")`); return 64; }
      let k = stueck.slice(0, i);
      const anhaengen = k.endsWith("+") && ["pfadliste", "namensliste", "wortliste"].includes(SCHEMA[k.slice(0, -1)]?.typ);
      if (anhaengen) k = k.slice(0, -1);
      const w = parseEinstellungsWert(SCHEMA[k], stueck.slice(i + 1));
      neu[k] = anhaengen && Array.isArray(w) ? [...(Array.isArray(neu[k]) ? neu[k] : werte[k] || []), ...w] : w;
    }
    schreibeAutomatik(vault, neu, stand);
    // Ich-Karte geändert → AGENTS.md im Vault neu rendern (Final-Review #1), damit Codex/Gemini/Cursor es sofort sehen.
    if (leseAutomatik(vault).werte.ichKarte !== werte.ichKarte) await rendereAgentsDatei(vault);
    console.log("Einstellungen gespeichert.");
    return 0;
  },
  // „brain aufgabe neu "<titel>" [--prio niedrig|normal|hoch] [--faellig JJJJ-MM-TT] [--text "…"] “, „brain aufgabe erledigt <pfad>“,
  // „brain aufgabe status <pfad> offen|in-arbeit|warten|erledigt“, „brain aufgabe archivieren <pfad> | --alte [--tage 30]“ (erledigte Aufgaben in den Unterordner
  // „archiv“ verschieben, nie löschen), „brain aufgaben [--status offen] [--alle] [--json]“ — Aufgaben im Vault (aufgaben.mjs, je Aufgabe eine
  // Markdown-Datei). Schreibende Unterbefehle laufen nur in einem vertrauten Vault (unten, WIRKEND).
  aufgabe: async (unter, ...a) => {
    const m = await import("./aufgaben.mjs");
    const { pos, opt } = leseOptionen(a, ["prio", "faellig", "text", "quelle", "status", "bezug", "tage"]);
    const nutzung = () => { console.error("Nutzung: kortex aufgabe neu \"<titel>\" [--prio hoch] [--faellig 2026-11-03] [--text \"…\"] | kortex aufgabe erledigt <pfad> | kortex aufgabe status <pfad> <status> | kortex aufgabe archivieren <pfad> | kortex aufgabe archivieren --alte [--tage 30]"); return 64; };
    try {
      if (unter === "neu") {
        const titel = pos.join(" ").trim();
        if (!titel) return nutzung();
        if (opt.quelle !== undefined) { console.error("Die Quelle der Aufgabe wird automatisch bestimmt (Mensch oder das KI-Programm, aus dem der Befehl läuft)."); return 64; }
        const r = m.legeAn(vault, { titel, ...(opt.prio ? { prioritaet: opt.prio } : {}), ...(opt.faellig ? { faellig: opt.faellig } : {}),
          ...(opt.text ? { text: opt.text } : {}), quelle: m.quelleAusUmgebung(process.env), ...(opt.bezug ? { bezug: opt.bezug.split(",") } : {}) });
        console.log(`Aufgabe angelegt: ${r.pfad}`);
        return 0;
      }
      if (unter === "archivieren") {
        // verschiebt nur nach <aufgaben-ordner>/archiv/ — gelöscht wird nichts; archiviert werden nur erledigte Aufgaben
        if (opt.alte) {
          if (pos.length) return nutzung();
          const tage = opt.tage === undefined ? m.ARCHIV_TAGE : (/^\d+$/.test(String(opt.tage)) ? Number(opt.tage) : NaN);
          const r = m.archiviereAlte(vault, { tage });
          for (const x of r.archiviert) console.log(`Archiviert: ${x.von} → ${x.pfad}`);
          console.log(r.archiviert.length ? `${r.archiviert.length} erledigte Aufgabe(n) archiviert (älter als ${r.tage} Tage).` : `Keine erledigte Aufgabe älter als ${r.tage} Tage.`);
          if (r.uebersprungen) console.error(`Hinweis: ${r.uebersprungen} Aufgabe(n) ließen sich nicht verschieben und blieben stehen.`);
          return 0;
        }
        if (opt.tage !== undefined || !pos[0] || pos.length > 1) return nutzung();
        const r = m.archiviere(vault, m.findePfad(vault, pos[0]));
        console.log(`Archiviert: ${r.von} → ${r.pfad}`);
        return 0;
      }
      if (unter === "erledigt" || unter === "status") {
        const ziel = pos[0], status = unter === "erledigt" ? "erledigt" : pos[1];
        if (!ziel || !status) return nutzung();
        const r = m.aendere(vault, m.findePfad(vault, ziel), { status });
        console.log(`${r.aufgabe.titel}: ${r.aufgabe.status}`);
        return 0;
      }
    } catch (e) {
      if (e instanceof m.AufgabeFehler) { console.error(e.message); return e.code === 404 ? 1 : 64; }
      throw e;
    }
    return nutzung();
  },
  aufgaben: async (...a) => {
    const m = await import("./aufgaben.mjs");
    const { opt } = leseOptionen(a, ["status"]);
    const roh = m.liste(vault, { kopf: true });
    let l = roh;
    if (opt.status) {
      if (!m.STATUS.includes(opt.status)) { console.error(`Status: ${m.STATUS.join(" | ")}`); return 64; }
      l = l.filter((x) => x.status === opt.status);
    } else if (!opt.alle) l = l.filter((x) => x.status !== "erledigt");
    if (opt.json) console.log(JSON.stringify(l.map(({ text, ...rest }) => rest)));
    else if (!l.length) console.log("Keine Aufgaben.");
    else for (const x of l) console.log(m.zeile(x));
    if (roh.abgeschnitten) console.error(`Hinweis: Es gibt mehr als ${m.MAX_DATEIEN} Aufgaben — gezeigt werden die neuesten.`);
    return 0;
  },
  backup: async (unter, a, b) => {
    const m = await import("./backup.mjs");
    if (!unter) { console.log(m.sichern(vault)); return 0; }
    if (unter === "einrichten") {
      if (!a) { console.error("Nutzung: brain backup einrichten github|ordner:<pfad>|keins"); return 64; }
      let cfg;
      try { cfg = m.einrichten(vault, a); } catch (e) { console.error(e.message); return 1; }
      const text = cfg.art === "github" ? "Sicherung eingerichtet: GitHub."
        : cfg.art === "ordner" ? `Sicherung eingerichtet: Ordner ${cfg.pfad}.`
        : "Sicherung eingerichtet: keine Sicherung.";
      console.log(text);
      return 0;
    }
    if (unter === "wiederherstellen") {
      if (!a || !b) { console.error("Nutzung: brain backup wiederherstellen <bundle-datei|github-url> <ziel>"); return 64; }
      const r = m.wiederherstellen(a, b);
      console.log(r.text);
      return r.ok ? 0 : 1;
    }
    console.error("Nutzung: brain backup [einrichten github|ordner:<pfad>|keins] [wiederherstellen <quelle> <ziel>]");
    return 64;
  },
  // Konflikt beim Abgleich (Studio „Konflikt in N Notizen“): JSON auf stdout, immer Exit 0 (Fehler stehen als { ok: false, fehler, status }). Eingabe bei loesen/ansicht:
  // JSON auf stdin (--stdin) mit { auswahl, basis }. Siehe abgleich-konflikt.mjs.
  abgleich: async (unter, ...a) => {
    const m = await import("./abgleich-konflikt.mjs");
    const gib = (o) => { console.log(JSON.stringify(o)); return 0; };
    let eingabe = {};
    if (a.includes("--stdin")) { try { eingabe = JSON.parse(readFileSync(0, "utf8") || "{}"); } catch { return gib({ ok: false, fehler: "Die Eingabe war nicht lesbar.", status: 400 }); } }
    try {
      if (unter === "ansicht") return gib({ ok: true, ...m.ansicht(vault, { basis: eingabe.basis }), rueckgaengig: m.rueckgaengigStand(vault) });
      if (unter === "loesen") return gib(m.loesen(vault, { auswahl: eingabe.auswahl, basis: eingabe.basis }));
      if (unter === "abbrechen") return gib(m.abbrechen(vault));
      if (unter === "rueckgaengig") return gib(m.rueckgaengig(vault));
      console.error("Nutzung: brain abgleich ansicht|loesen|abbrechen|rueckgaengig [--stdin]");
      return 64;
    } catch (e) {
      if (e instanceof m.KonfliktFehler) return gib({ ok: false, fehler: e.message, status: e.status, ...e.extra });
      return gib({ ok: false, fehler: "Der Abgleich ist fehlgeschlagen.", status: 500 });
    }
  },
};

const f = befehle[befehl];
if (!f) { console.error(`Befehle: ${Object.keys(befehle).join(" | ")}`); process.exit(64); }
// Der Hintergrunddienst (LaunchAgent) folgt dem aktiven Vault, läuft aber nur für Vaults, für die er ausdrücklich eingeschaltet wurde (tageslauf/dienst-merker.mjs).
// Kein gültiger oder nicht freigegebener Vault: der Lauf endet still mit Exit 0 (eine Zeile im Protokoll des Dienstes).
if (befehl === "tageslauf" && rest.includes("--dienst")) {
  const grund = !vault ? "kein aktiver Vault"
    : !vaultVertraut(vault) ? "dieser Vault ist nicht als deiner bestätigt"
    : (await import("./tageslauf/dienst-merker.mjs")).dienstErlaubt(vault) ? null : "für diesen Vault ist der Dienst nicht eingeschaltet";
  if (grund) { console.error(`${new Date().toISOString()} Hintergrunddienst: ${grund} — Lauf übersprungen.`); process.exit(0); }
}
if (!vault && !OHNE_VAULT.has(befehl)) { console.error(vaultFehler.message); process.exit(2); }
// Workspace-Trust (P5): Befehle, die am Vault etwas bewirken (git, Hintergrunddienst, KI-Pflege, Hooks eintragen), laufen nur in einem Vault, den Kortex angelegt
// oder geklont oder der Nutzer im Studio bestätigt hat. Lesen, Suchen, Ansehen, Status, Lint und die Einstellungen bleiben möglich.
const WIRKEND = new Set(["tageslauf", "dienst", "traum", "nachernte", "antworten", "zurueck", "backup", "abgleich", "hooks-install", "gedaechtnis", "aufgabe"]);
if (vault && WIRKEND.has(befehl) && !(befehl === "backup" && rest[0] === "wiederherstellen") && !(befehl === "dienst" && ["status", "aus"].includes(rest[0])) && !vaultVertraut(vault)) {
  console.error(NICHT_VERTRAUT_TEXT);
  process.exit(5);
}
// befehle sind sonst synchron; backup ist async (dynamischer Import) — await auf einen einfachen
// Rückgabewert löst sofort auf, ändert also nichts am Verhalten der anderen Befehle.
try {
  const code = await f(...rest);
  process.exit(code);
} catch (e) {
  console.error(`Fehler: ${String(e?.message || e).split("\n")[0]}`);
  process.exit(1);
}
