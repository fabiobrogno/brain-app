// electron/haupt.mjs — Hauptprozess der Kortex-Hülle für Windows und Linux (Paket W2a; am Mac läuft weiter die Swift-App).
// Aufbau: Die Werkstatt (Ressourcen/werkstatt/werkstatt.mjs, dieselbe Datei wie in der Swift-App) läuft als KINDPROZESS und spricht das Zeilenprotokoll (bruecke.mjs).
// Das Studio lädt über das eigene Schema `kortex://studio/` (protocol.handle → Brücke): kein Port, kein Token, kein Netzwerkweg zur Werkstatt. Die Seite sieht nur
// `window.kortexHuelle` (preload.cjs); die Aktionen des Hüllen-Vertrags setzt aktionen.mjs um, geprüft wird im Hauptprozess.
// Paket W2b: App-Menü (menue.mjs), Tray (tray.mjs), Schnell-Erfassen-Fenster (erfassen-fenster.mjs) mit globalem Kürzel (kuerzel.mjs), Mitteilungen (mitteilungen.mjs), App-Symbol (symbole.mjs),
// durchscheinende Seitenleiste (glas.mjs).
// Paket W2c: installierbare Pakete (electron-builder, electron/paket/), eigenes Node im Paket (laufzeit.mjs legt es und den Kern stabil in den Support-Ordner), Updates (updater.mjs), GitHub-Anmeldung
// (Client-ID aus Ressourcen/Info.plist). Nicht im Paket: Signatur unter Windows (Betas unsigniert), Veröffentlichen (docs/plaene/plattformen-windows-linux.md, docs/veroeffentlichen.md).
import { app, BrowserWindow, Menu, Notification, Tray, clipboard, dialog, globalShortcut, ipcMain, nativeImage, nativeTheme, powerMonitor, protocol, session, shell } from "electron";
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, release } from "node:os";
import { dirname, join, isAbsolute } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { erzeugeAktionen, ASYNCHRON } from "./aktionen.mjs";
import { darfSchliessen, SKRIPT as SCHLIESSEN_SKRIPT } from "./schliessen.mjs";
import { pruefeGitAsync } from "./git.mjs";
import { starteBruecke, baueKindUmgebung, findeNode } from "./bruecke.mjs";
import { installiereLaufzeit } from "./laufzeit.mjs";
import { githubClientId } from "./info-plist.mjs";
import { erzeugeUpdater, konfiguriere, updatesMoeglich } from "./updater.mjs";
import { SCHEMA, HOST, START_URL, istEigeneAdresse, externPruefen } from "./navigation.mjs";
import { erzeugeGlobaleKuerzel, anzeigeText, acceleratorVon } from "./kuerzel.mjs";
import { baueMenueVorlage } from "./menue.mjs";
import { baueTrayVorlage, trayZustand, trayTitel } from "./tray.mjs";
import { leseEinstellungen as leseMitteilungsEinstellungen, erzeugePlaner, erzeugeLeser, probeMitteilung } from "./mitteilungen.mjs";
import { erzeugeErfassenFenster, antwortErfassen, ERFASSEN_HOST } from "./erfassen-fenster.mjs";
import { hinweisFuerVault, pruefeEingabe, baueAnfrage, antwortAus, leseArt, merkeArt } from "./erfassen.mjs";
import { leseAppSymbol, symbolPfade } from "./symbole.mjs";
import { glasMoeglich, leseGlasWunsch, glasSkript } from "./glas.mjs";
import { htmlZuPdf } from "./pdf.mjs"; // Export als PDF (Aktion export-pdf)

const HIER = dirname(fileURLToPath(import.meta.url));
// Ressourcen des Repos (Studio, Werkstatt, gemeinsam): im Repo ../Ressourcen, im Paket <resources>/Ressourcen (electron/paket/ressourcen.mjs)
const RESSOURCEN = app.isPackaged ? join(process.resourcesPath, "Ressourcen") : join(HIER, "..", "Ressourcen");
const laden = (rel) => import(pathToFileURL(join(RESSOURCEN, rel)).href);
// Im Paket gibt es kein Debuggen von außen: --inspect und --remote-debugging-* beenden die App (die Fuses der Release-Variante schalten es zusätzlich ab; nur die Test-Variante für Playwright lässt es zu)
const PAKET_FUSES = (() => { try { return JSON.parse(readFileSync(join(RESSOURCEN, "paket.json"), "utf8")).fuses; } catch { return "release"; } })();
if (app.isPackaged && PAKET_FUSES !== "test" && process.argv.some((a) => /^--(inspect|remote-debugging-|remote-allow-origins)/.test(a))) process.exit(1);
const { supportOrdner, beendeBaum } = await laden("gemeinsam/plattform.mjs");
const { pruefeOrdner, gitInstallHinweis, leseEinrichtung, schreibeEinrichtung } = await laden("werkstatt/browser-ordner.mjs");
const { absoluterGitPfad, kindUmgebung, vorschauOrdnerAus } = await laden("gemeinsam/basis.mjs");
const { MAX_KOERPER } = await laden("werkstatt/handler.mjs"); // dieselbe Grenze wie die Werkstatt (nicht doppelt festgeschrieben)
// W2b: Register und Logik der Tastenkürzel, Aktivitätsprotokoll, Kurzformen — dieselben Dateien wie Studio und Werkstatt, nichts doppelt
const { ladeRegister, leseDatei: leseKuerzelDatei } = await laden("werkstatt/tastenkuerzel.mjs");
const kuerzelLogik = await laden("gemeinsam/tastenkuerzel-logik.mjs");
const { ART_SCHALTER, leseEreignisse, protokollKennungen, ereignisDatei } = await laden("gemeinsam/aktivitaet.mjs");
const { ladeKatalog } = await laden("gemeinsam/ki-katalog.mjs");
const { liesKurzformen } = await laden("gemeinsam/kurzformen.mjs");

// Entwicklerwerkzeuge nur beim Entwickeln: im Paket öffnet auch KORTEX_ENTWICKLER keine (die Seite hat die Hülle im Griff, DevTools wären eine zweite Tür)
const ENTWICKLER = !app.isPackaged;
// Testlauf (BRAIN_TESTMODUS) und Vorschau: wie in der Mac-App meldet die Hülle dann kein globales Kürzel an (es gehört der echten App); die Tests schalten es mit KORTEX_TEST_GLOBALE_KUERZEL=1 ausdrücklich ein
const TESTMODUS = process.env.BRAIN_TESTMODUS === "1";
const GLOBALE_KUERZEL = !process.env.KORTEX_VORSCHAU && (!TESTMODUS || process.env.KORTEX_TEST_GLOBALE_KUERZEL === "1");
// Schließen des Hauptfensters: unter Windows läuft Kortex im Infobereich weiter (Tray, globales Kürzel, Mitteilungen), sonst beendet es die App (Linux: ob ein Tray sichtbar ist, weiß die App nicht)
const IN_TRAY_SCHLIESSEN = process.env.KORTEX_SCHLIESSEN_IN_TRAY === "1" || (process.platform === "win32" && process.env.KORTEX_SCHLIESSEN_IN_TRAY !== "0");
const JSON_KOPF = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
const SCHREIBEND = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const ERLAUBT = new Set(["GET", "HEAD", ...SCHREIBEND]);

// Alles, was die Hülle schreibt (Chromium-Daten, Protokoll), liegt im Support-Ordner (BRAIN_APP_SUPPORT lenkt ihn um: Tests, Vorschau) — nie an einem Ort, den wir nicht benennen.
const support = supportOrdner();
const datenOrdner = join(support, "electron");
mkdirSync(datenOrdner, { recursive: true });
app.setPath("userData", datenOrdner);
app.setPath("sessionData", join(datenOrdner, "Sitzung"));
app.setPath("crashDumps", join(datenOrdner, "Absturzberichte"));
app.setAppLogsPath(join(datenOrdner, "Protokoll"));

// Zeile ins Protokoll der Hülle (nie Notiztitel, Texte der Zwischenablage oder Adressen mit Zugangsdaten); über 1 MB wird nichts mehr geschrieben
const logDatei = join(datenOrdner, "huelle.log");
function protokoll(zeile) {
  try {
    if (existsSync(logDatei) && statSync(logDatei).size > 1_000_000) return;
    appendFileSync(logDatei, `${new Date().toISOString()} ${String(zeile).replace(/[\r\n]+/g, " ").slice(0, 600)}\n`, { mode: 0o600 });
  } catch { /* das Protokoll ist eine Bequemlichkeit */ }
}

function liesArgumente(argv) {
  const o = { vault: undefined };
  for (let i = 0; i < argv.length; i++) if (argv[i] === "--vault" && argv[i + 1]) o.vault = argv[++i];
  if (o.vault !== undefined && !isAbsolute(o.vault)) o.vault = undefined;
  return o;
}
const optionen = liesArgumente(process.argv.slice(1));

protocol.registerSchemesAsPrivileged([{ scheme: SCHEMA, privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

let fenster = null, bruecke = null, endeLaeuft = false, schliessenFrei = false, schliessenLaeuft = false, beendet = false, gestartet = false;
const abstuerze = [];

// ───────────── Aktionen des Hüllen-Vertrags ─────────────
const vaultPfad = async () => {
  try { const r = await bruecke.anfrage({ methode: "GET", pfad: "/api/info" }); const i = JSON.parse(r.body.toString("utf8")); return typeof i?.vault === "string" ? i.vault : null; }
  catch { return null; }
};
const befehlAnStudio = (name, wert) => {
  if (!fenster || fenster.isDestroyed() || !/^[a-z]+(-[a-z]+)*$/.test(name)) return;
  fenster.webContents.executeJavaScript(`window.studio?.befehl(${JSON.stringify(name)}, ${JSON.stringify(wert ?? null)})`).catch(() => {});
};
const aktionen = erzeugeAktionen({
  support,
  vaultPfad,
  openExternal: (url) => { shell.openExternal(url).catch(() => {}); },
  showItemInFolder: (pfad) => shell.showItemInFolder(pfad),
  schreibeZwischenablage: (text) => clipboard.writeText(text),
  waehleOrdner: async ({ titel, vorschlag }) => {
    const r = await dialog.showOpenDialog(...(fenster ? [fenster] : []), {
      ...(titel ? { title: titel } : {}),
      ...(vorschlag ? { defaultPath: vorschlag } : {}),
      properties: ["openDirectory", "createDirectory"],
    });
    return r.canceled || !r.filePaths?.length ? null : r.filePaths[0];
  },
  // Export: Speichern-Dialog am Hauptfenster (Aktionen export-speichern, export-pdf) und PDF aus dem HTML der Werkstatt (pdf.mjs)
  waehleSpeichern: async ({ name, endung }) => {
    const r = await dialog.showSaveDialog(...(fenster ? [fenster] : []), {
      defaultPath: name,
      properties: ["createDirectory", "showOverwriteConfirmation"],
      ...(endung ? { filters: [{ name: endung.toUpperCase(), extensions: [endung] }] } : {}),
    });
    return r.canceled || !r.filePath ? null : r.filePath;
  },
  pdfRendern: (html) => htmlZuPdf(html),
  mitteilung: () => zeigeProbeMitteilung(),
  statusAuffrischen: () => statusAuffrischen(),
  kuerzel: { pruefeGlobal: (id, text) => kuerzel.pruefeGlobal(id, text), neuLesen: () => kuerzelNeuLesen() },
  appSymbol: (name) => wendeAppSymbolAn(name),
  fensterGlas: (an) => wendeGlasAn(an),
  darstellung: (quelle) => { nativeTheme.themeSource = quelle; },
  fensterTitel: (text) => { fenster?.setTitle(text || "Kortex"); },
  fensterZoom: () => { if (!fenster) return; if (fenster.isMaximized()) fenster.unmaximize(); else fenster.maximize(); },
  befehlAnStudio,
  protokoll,
  einrichtung: { lese: leseEinrichtung, schreibe: schreibeEinrichtung },
  ordner: { pruefeOrdner },
  git: { pruefen: () => pruefeGitAsync({ gitPfad: absoluterGitPfad, umgebung: kindUmgebung }), hinweis: () => gitInstallHinweis() },
});

// ───────────── W2b: Kürzel, Erfassen-Fenster, Menü, Tray, Mitteilungen, Symbol, Glas ─────────────
const register = ladeRegister();
const belegung = () => kuerzelLogik.wirksam(register, leseKuerzelDatei(support, register).ueberschrieben); // Register + eigene Kürzel (tastenkuerzel.json), wie die Werkstatt
const kuerzel = erzeugeGlobaleKuerzel({ register, logik: kuerzelLogik, globalShortcut, aktiv: GLOBALE_KUERZEL, wayland: process.platform === "linux" && process.env.XDG_SESSION_TYPE === "wayland", protokoll });
let kuerzelHinweis = null; // Hinweis zum Kürzel „Schnell erfassen“ (belegt …): steht im Erfassen-Fenster, bis der Nutzer ein anderes wählt

const leseJson = async (pfad, query) => { try { const r = await bruecke.anfrage({ methode: "GET", pfad, query }); return r.status === 200 ? JSON.parse(r.body.toString("utf8")) : null; } catch { return null; } };
const BEREIT_SKRIPT = `new Promise((ok) => { if (window.__studioBereit) return ok(true); addEventListener("studio-bereit", () => ok(true), { once: true }); setTimeout(() => ok(false), 20000); })`;
async function studioBereit({ warteAufLaden = true } = {}) { // aus did-finish-load heraus mit warteAufLaden: false (dort steht isLoading noch auf true)
  if (!fenster || fenster.isDestroyed()) return false;
  const wc = fenster.webContents;
  if (warteAufLaden && wc.isLoading()) await new Promise((ok) => wc.once("did-finish-load", ok));
  return wc.executeJavaScript(BEREIT_SKRIPT);
}
function zeigeStudio() {
  if (fenster && !fenster.isDestroyed()) { if (fenster.isMinimized()) fenster.restore(); fenster.show(); fenster.focus(); }
  else oeffneFenster();
}
const mitStudio = async (fn) => { zeigeStudio(); if (await studioBereit()) fn(); };

// Klick im Menü oder im Tray: { befehl: Menü-Name des Studio-Befehls } | { fest: eigene Aktion der Hülle }
function menueAktion(a) {
  if (a.befehl) { mitStudio(() => befehlAnStudio(a.befehl)).catch(() => {}); return; }
  switch (a.fest) {
    case "erfassen": erfassen.umschalten(); break;
    case "einrichten": mitStudio(() => aktionen.aktion("einrichtung-oeffnen", {})).catch(() => {}); break;
    case "schliessen": if (fenster && !fenster.isDestroyed()) fenster.close(); break;
    case "beenden": app.quit(); break;
    case "updates": updater.pruefe({ manuell: true }).catch(() => {}); break;
    case "studio": zeigeStudio(); break;
    case "ordner-zeigen": vaultPfad().then((v) => { if (v) shell.showItemInFolder(v); }); break;
  }
}
const setzeMenue = () => Menu.setApplicationMenu(Menu.buildFromTemplate(baueMenueVorlage({ register, logik: kuerzelLogik, belegung: belegung(), entwickler: ENTWICKLER, updates: UPDATES.moeglich, aktion: menueAktion })));

// ── App-Symbol (Fenster, Tray, Erfassen-Fenster); gewählt in den Einstellungen, beim Start gelesen
let aktuellesSymbol = leseAppSymbol(support);
const bildVon = (name, art) => { const p = symbolPfade(name); if (!p) return null; const b = nativeImage.createFromPath(p[art]); return b.isEmpty() ? null : b; };
const trayBild = () => { const b = bildVon(aktuellesSymbol, "tray"); return b ? b.resize({ width: process.platform === "win32" ? 16 : 22, quality: "best" }) : null; };
function wendeAppSymbolAn(name) {
  const b = bildVon(name, "fenster");
  if (!b) return false;
  aktuellesSymbol = name;
  if (fenster && !fenster.isDestroyed()) fenster.setIcon(b); // Windows: das Taskleisten-Symbol zur Laufzeit nur über das Fenster
  erfassen.setzeBild(b);
  if (process.platform === "darwin") app.dock?.setIcon(b);
  const t = trayBild(); if (tray && t) tray.setImage(t);
  protokoll(`aktion app-symbol ${name}`);
  return true;
}

// ── Durchscheinende Seitenleiste: nur Windows 11 22H2+ (Mica); sonst nicht möglich (Testschalter nur im Testlauf)
const GLAS = (TESTMODUS && process.env.KORTEX_TEST_GLAS_MOEGLICH === "1") || glasMoeglich({ release: release() });
let glasWunsch = leseGlasWunsch(support);
const zeigeGlasAnSeite = () => { const skript = glasSkript({ moeglich: GLAS, an: glasWunsch }); if (skript && fenster && !fenster.isDestroyed()) fenster.webContents.executeJavaScript(skript).catch(() => {}); };
function wendeGlasAn(an) { // → null (kein Fenstermaterial möglich) | wirkt
  if (!GLAS) return null;
  glasWunsch = an;
  if (fenster && !fenster.isDestroyed()) { fenster.setBackgroundMaterial?.(an ? "mica" : "none"); fenster.setBackgroundColor?.(an ? "#00000000" : nativeTheme.shouldUseDarkColors ? "#16181c" : "#ffffff"); zeigeGlasAnSeite(); }
  return an;
}

// ── Schnell-Erfassen-Fenster und globale Kürzel (Befehle des Registers mit global: true)
async function erfassenInfo() {
  const info = await leseJson("/api/info");
  const name = typeof info?.vault === "string" ? info.name : null;
  return { art: leseArt(support), vault: name, hinweis: hinweisFuerVault({ name, erlaubt: info?.vertrauen?.erlaubt === true }) ?? kuerzelHinweis, kuerzel: anzeigeText(belegung()["schnell-erfassen"], { register, logik: kuerzelLogik }) };
}
async function erfassenSpeichere(eingabe) {
  const p = pruefeEingabe(eingabe);
  if (!p.ok) return { ok: false, text: p.text };
  const info = await leseJson("/api/info");
  const name = typeof info?.vault === "string" ? info.name : null;
  const hinweis = hinweisFuerVault({ name, erlaubt: info?.vertrauen?.erlaubt === true });
  if (hinweis) return { ok: false, text: hinweis };
  const a = baueAnfrage(p.wert, { liesKurzformen });
  if (a.fehler) return { ok: false, text: a.fehler };
  let r;
  try { r = await bruecke.anfrage({ methode: "POST", pfad: a.pfad, body: Buffer.from(JSON.stringify(a.koerper)) }); }
  catch { return { ok: false, text: "Kortex ist noch nicht bereit. Warte einen Moment und versuche es noch einmal." }; }
  let json = null; try { json = JSON.parse(r.body.toString("utf8")); } catch { /* keine JSON-Antwort */ }
  const antwort = antwortAus({ status: r.status, json }, name);
  if (antwort.ok) { merkeArt(support, p.wert.art); statusAuffrischen(); }
  protokoll(`erfassen ${antwort.ok ? "gespeichert" : "abgelehnt"} ${p.wert.art}`); // nie der Text
  return antwort;
}
const erfassen = erzeugeErfassenFenster({ preload: join(HIER, "erfassen-preload.cjs"), url: `${SCHEMA}://${ERFASSEN_HOST}/`, bild: () => bildVon(aktuellesSymbol, "fenster"), entwickler: ENTWICKLER, testmodus: TESTMODUS, protokoll, info: erfassenInfo, speichere: erfassenSpeichere });
kuerzel.setzeAktion("schnell-erfassen", () => erfassen.umschalten());
kuerzel.setzeAktion("frage-global", () => { mitStudio(() => befehlAnStudio("frage")).catch(() => {}); });
kuerzel.setzeAktion("kortex-zeigen", () => zeigeStudio());
function kuerzelAnwenden() { const h = kuerzel.wendeAn(belegung()); kuerzelHinweis = h["schnell-erfassen"] ?? null; setzeMenue(); zeichneTray(); erfassen.erneuern(); return h; }
function kuerzelNeuLesen() { protokoll("aktion kuerzel-geaendert"); kuerzelAnwenden(); }

// ── Tray (Windows Infobereich, Linux AppIndicator): Menü wie die Menüleiste der Mac-App; ohne Tray-Unterstützung läuft die App ohne
let tray = null, trayDaten = { info: null, aktivitaet: null, rueckfragen: null }, trayVorlage = [], trayTooltip = "", trayAuffrischer = null, rueckfragenStand = 0;
async function aktualisiereTray() {
  if (!tray) return;
  const [info, aktivitaet] = await Promise.all([leseJson("/api/info"), leseJson("/api/aktivitaet", "nur=ungelesen&limit=1")]);
  trayDaten = { ...trayDaten, info, aktivitaet };
  zeichneTray();
  // Rückfragen kennt die Werkstatt nur mit Kit und liest sie in einem eigenen Prozess (gebündelt, höchstens alle 2 min): nie auf sie warten
  if (info?.vault && Date.now() - rueckfragenStand > 120_000) { rueckfragenStand = Date.now(); leseJson("/api/rueckfragen").then((r) => { trayDaten = { ...trayDaten, rueckfragen: r }; zeichneTray(); }); }
}
function zeichneTray() {
  if (!tray) return;
  const text = belegung()["schnell-erfassen"];
  const z = { ...trayZustand(trayDaten, text ? acceleratorVon(text, { register, logik: kuerzelLogik }) : null), updates: UPDATES.moeglich };
  trayVorlage = baueTrayVorlage(z, menueAktion);
  trayTooltip = trayTitel(z);
  tray.setContextMenu(Menu.buildFromTemplate(trayVorlage));
  tray.setToolTip(trayTooltip);
}
// `status-auffrischen`, Vault- und Vertrauenswechsel: Tray liest den Stand neu, gebündelt (ein Lauf je Sekunde)
function statusAuffrischen() { if (!tray || trayAuffrischer) return; trayAuffrischer = setTimeout(() => { trayAuffrischer = null; aktualisiereTray(); }, 1000); }
function starteTray() {
  try {
    const bild = trayBild();
    if (!bild) throw new Error("kein Symbol");
    tray = new Tray(bild);
    if (process.platform === "win32") tray.on("click", () => zeigeStudio()); // Linux (AppIndicator) kennt keinen Klick, dort gibt es nur das Menü
    zeichneTray();
    aktualisiereTray();
    setInterval(() => aktualisiereTray(), 60_000).unref();
  } catch (e) { tray = null; protokoll(`tray aus: ${e?.message || e}`); } // z. B. Linux ohne Tray-Unterstützung: die App läuft sauber ohne
}
const bleibtImTray = () => !beendet && !!tray && IN_TRAY_SCHLIESSEN;

// ── Mitteilungen des Systems aus dem Aktivitätsprotokoll (Takt 2 s wie MitteilungsDienst in Swift); Klick bringt das Studio nach vorn und öffnet das Ziel
const gehalten = new Set(); // gezeigte Mitteilungen, bis sie geschlossen oder angeklickt sind
const MELDUNGEN = []; // Testlauf: die gezeigten Mitteilungen (Objekt, Text, Ziel), zum Prüfen; sonst leer
function zeigeMitteilung(m) {
  const n = new Notification({ title: m.titel, ...(m.untertitel ? { subtitle: m.untertitel } : {}), body: m.text, silent: !m.ton });
  gehalten.add(n); n.on("close", () => gehalten.delete(n)); // Electron räumt sonst das Objekt samt Klick-Handler weg
  n.on("click", () => { gehalten.delete(n); mitStudio(() => befehlAnStudio(m.ziel)).catch(() => {}); });
  if (TESTMODUS) { MELDUNGEN.push({ titel: m.titel, untertitel: m.untertitel, text: m.text, ziel: m.ziel, art: m.art ?? null, objekt: n }); if (MELDUNGEN.length > 50) MELDUNGEN.shift(); }
  else n.show();
}
function zeigeProbeMitteilung() {
  if (!Notification.isSupported() && !TESTMODUS) return false;
  zeigeMitteilung(probeMitteilung({ ton: leseMitteilungsEinstellungen(support).mitteilungenTon, kennung: `kortex-probe-${Date.now()}` }));
  return Notification.isSupported();
}
const kortexVorne = () => !!fenster && !fenster.isDestroyed() && fenster.isVisible() && !fenster.isMinimized() && fenster.isFocused();
function starteMitteilungen() {
  if (!Notification.isSupported() && !TESTMODUS) { protokoll("mitteilungen-aus nicht-unterstuetzt"); return; }
  const leser = erzeugeLeser({ support, leseEreignisse, protokollKennungen,
    dateiStand: (k) => { try { const st = statSync(ereignisDatei(support, k)); return `${st.size}:${st.mtimeMs}`; } catch { return null; } } });
  let bekannte = []; try { bekannte = ladeKatalog().map((e) => e.name); } catch { bekannte = ["Claude Code", "Codex"]; }
  const regeln = TESTMODUS && process.env.KORTEX_TEST_SAMMELFENSTER ? { sammelfenster: Number(process.env.KORTEX_TEST_SAMMELFENSTER) } : {};
  const planer = erzeugePlaner({ artSchalter: ART_SCHALTER, bekannteProgramme: bekannte, regeln });
  const takt = () => {
    const e = leseMitteilungsEinstellungen(support);
    planer.aufnehmen(leser.neueEreignisse(), e);
    const faellig = planer.faellige(e, kortexVorne());
    for (const m of faellig) zeigeMitteilung(m);
    if (faellig.length) { protokoll(`mitteilungen zugestellt=${faellig.length}`); statusAuffrischen(); } // nie Text oder Namen ins Protokoll
  };
  setInterval(takt, 2000).unref();
  protokoll("mitteilungen-an");
}

// Nur im Testlauf: Zugriff für die Playwright-Tests (Tray-Menü, gezeigte Mitteilungen, Erfassen-Fenster, Kürzel); die Seite sieht das nie, es gibt keinen Weg dorthin
if (TESTMODUS) globalThis.__kortex = { kuerzel, erfassen, mitteilungen: MELDUNGEN, tray: () => (tray ? { vorlage: trayVorlage, tooltip: trayTooltip } : null), aktualisiereTray, glas: GLAS, symbol: () => aktuellesSymbol, hinweis: () => kuerzelHinweis };

// Herunterfahren/Abmelden: derselbe Weg wie Beenden (die Seite sichert, die Werkstatt endet), nur mit kurzer Frist und ohne Rückfrage — das System wartet nicht auf einen Dialog
function sitzungEnde() {
  if (endeLaeuft) { app.quit(); return; }
  const f = fenster;
  if (!f || f.isDestroyed()) { app.quit(); return; }
  darfSchliessen({ frage: () => f.webContents.executeJavaScript(SCHLIESSEN_SKRIPT), rueckfrage: async () => true, protokoll, fristMs: 2000 }).then(() => { schliessenFrei = true; app.quit(); });
}
if (TESTMODUS) globalThis.__kortex.sitzungEnde = () => sitzungEnde();

function raeumeAuf() { try { kuerzel.beende(); globalShortcut.unregisterAll(); } catch { /* egal */ } try { tray?.destroy(); } catch { /* egal */ } tray = null; }

// Nur die eigene Seite im Hauptfenster darf Aktionen schicken (nie ein Unterrahmen, nie eine andere Adresse)
const vonStudio = (e) => !!fenster && e.sender === fenster.webContents && !!e.senderFrame && e.senderFrame === e.sender.mainFrame && istEigeneAdresse(e.senderFrame.url);
const KEIN_ZUGRIFF = { ok: false, grund: "herkunft" };
ipcMain.on("kortex:huelle-info", (e) => { e.returnValue = vonStudio(e) ? { aktionen: aktionen.namen, asynchron: ASYNCHRON } : null; });
ipcMain.on("kortex:aktion-sync", (e, name, wert) => {
  if (!vonStudio(e)) { e.returnValue = KEIN_ZUGRIFF; return; }
  const r = aktionen.aktion(name, wert);
  e.returnValue = r && typeof r.then === "function" ? { ok: false, grund: "unbekannt" } : (r === undefined ? null : r);
});
ipcMain.handle("kortex:aktion", async (e, name, wert) => {
  if (!vonStudio(e)) return KEIN_ZUGRIFF;
  const r = await aktionen.aktion(name, wert);
  return r === undefined ? null : r;
});

// ───────────── Schema kortex://studio → Werkstatt ─────────────
const antwortJson = (status, o) => new Response(JSON.stringify(o), { status, headers: JSON_KOPF });
async function beantworte(request) {
  const u = new URL(request.url);
  if (u.hostname === ERFASSEN_HOST) return antwortErfassen(request, { ordner: join(HIER, "erfassen"), studio: join(RESSOURCEN, "studio") }); // die Seite „Schnell erfassen“ (nur ihre festen Dateien)
  if (u.hostname !== HOST) return antwortJson(404, { fehler: "nicht gefunden" });
  const methode = request.method;
  if (!ERLAUBT.has(methode)) return antwortJson(405, { fehler: "Methode nicht erlaubt" });
  let body;
  if (SCHREIBEND.has(methode)) {
    // Origin: Chromium schickt ihn an protocol.handle nicht mit (gemessen: nur accept, content-type, user-agent); ist er da, muss er unser eigener sein. Fremde Seiten erreichen das
    // Schema ohnehin nicht (Navigation gesperrt, Netz gesperrt, CSP connect-src 'self'). Inhalt nur als JSON, wie im Browser-Dienst.
    const origin = request.headers.get("origin");
    if (origin !== null && origin !== `${SCHEMA}://${HOST}`) return antwortJson(403, { fehler: "Herkunft nicht erlaubt" });
    const bytes = Buffer.from(await request.arrayBuffer());
    if (bytes.length > MAX_KOERPER) return antwortJson(413, { fehler: "Anfrage zu groß" });
    if (bytes.length) {
      if (!/^application\/json\s*(;|$)/i.test(request.headers.get("content-type") || "")) return antwortJson(415, { fehler: "Nur JSON erlaubt" });
      body = bytes;
    }
  }
  let r;
  try { r = await bruecke.anfrage({ methode, pfad: u.pathname, query: u.search.slice(1), body }); }
  // 504 = Frist der Hülle gerissen (Ausgang unklar, wie bei der App: api.js ausgangUnklar), sonst 502
  catch (e) { return e?.code === "frist" ? antwortJson(504, { fehler: "Die Werkstatt hat nicht rechtzeitig geantwortet." }) : antwortJson(502, { fehler: "Die Werkstatt antwortet nicht." }); }
  const leer = methode === "HEAD" || r.status === 204 || r.status === 304 || !r.body.length;
  return new Response(leer ? null : r.body, { status: r.status, headers: r.headers });
}

// ───────────── Fenster ─────────────
function zeigeFehlerSeite(text) {
  const seite = `<!doctype html><meta charset="utf-8"><title>Kortex</title><body style="font:16px system-ui,sans-serif;max-width:34rem;margin:15vh auto;padding:0 1.5rem"><h1 style="font-size:1.2rem">Kortex</h1><p>${text}</p>`;
  fenster?.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(seite)}`).catch(() => {});
}

function oeffneFenster() {
  fenster = new BrowserWindow({
    width: 1280, height: 860, minWidth: 720, minHeight: 480, show: false, title: "Kortex",
    ...(bildVon(aktuellesSymbol, "fenster") ? { icon: bildVon(aktuellesSymbol, "fenster") } : {}),
    // Fenstermaterial (Windows 11): die Seite ist dann an der Seitenleiste durchsichtig (data-glas), sonst deckend
    ...(GLAS && process.platform === "win32" ? { backgroundMaterial: glasWunsch ? "mica" : "none" } : {}),
    backgroundColor: GLAS && glasWunsch ? "#00000000" : nativeTheme.shouldUseDarkColors ? "#16181c" : "#ffffff",
    webPreferences: {
      preload: join(HIER, "preload.cjs"),
      contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true,
      allowRunningInsecureContent: false, webviewTag: false, devTools: ENTWICKLER,
    },
  });
  const wc = fenster.webContents;
  schliessenFrei = false; // ein neues Fenster (nach dem Schließen in den Tray) sichert wieder vor dem Schließen
  wc.on("dom-ready", zeigeGlasAnSeite);
  fenster.once("ready-to-show", () => fenster?.show());
  fenster.on("session-end", () => { protokoll("session-end"); sitzungEnde(); }); // Windows: Herunterfahren oder Abmelden
  // Schließen sichert zuerst (wie Swift darfSchliessen): einmal anhalten, die Seite fragen, bei „nicht gespeichert“ den Nutzer; erst danach schließen
  fenster.on("close", (e) => {
    if (schliessenFrei) return;
    e.preventDefault();
    if (schliessenLaeuft) return;
    schliessenLaeuft = true;
    const f = fenster;
    darfSchliessen({
      frage: () => f.webContents.executeJavaScript(SCHLIESSEN_SKRIPT),
      rueckfrage: async (grund) => (await dialog.showMessageBox(f, { type: "warning", message: "Änderungen nicht gespeichert", detail: grund, buttons: ["Trotzdem schließen", "Abbrechen"], defaultId: 1, cancelId: 1 })).response === 0,
      protokoll,
    }).then((ok) => { schliessenLaeuft = false; if (!ok) { beendet = false; updateNeustart = false; } /* Beenden abgebrochen */ if (ok && !f.isDestroyed()) { schliessenFrei = true; f.close(); } });
  });
  const dieses = fenster;
  fenster.on("closed", () => { if (fenster === dieses) fenster = null; if (!bleibtImTray()) app.quit(); });
  wc.on("did-start-navigation", (e) => { if (e.isMainFrame && !e.isSameDocument) aktionen.seiteNeu(); });
  // Absturz des Web-Prozesses: neu laden (?nachAbsturz=1), höchstens 3× in 60 s (wie WebProzessSchutz.swift)
  wc.on("render-process-gone", (_e, d) => {
    protokoll(`web-prozess beendet (${d.reason})`);
    if (d.reason === "clean-exit" || endeLaeuft) return;
    const jetzt = Date.now();
    while (abstuerze.length && jetzt - abstuerze[0] > 60_000) abstuerze.shift();
    if (abstuerze.length >= 3) return zeigeFehlerSeite("Das Fenster ist mehrmals abgestürzt. Starte Kortex neu.");
    abstuerze.push(jetzt);
    wc.loadURL(`${START_URL}?nachAbsturz=1`).catch(() => {});
  });
  wc.once("did-finish-load", () => { ersterStart().catch((e) => protokoll(`erster start: ${e?.message || e}`)); });
  fenster.loadURL(START_URL).catch((e) => { protokoll(`laden: ${e?.message || e}`); zeigeFehlerSeite("Das Studio ließ sich nicht laden."); });
}

// Erster Start: ohne Vault und ohne beendete Einrichtung öffnet die Hülle die Einrichtung selbst (am Mac tut das die App; der Browser macht es in huelle-browser.js genauso)
async function ersterStart() {
  const bereit = await studioBereit({ warteAufLaden: false });
  if (!bereit) return;
  if ((await vaultPfad()) === null && !leseEinrichtung(support).ende) aktionen.aktion("einrichtung-oeffnen", {});
}

// ───────────── Sicherheit je Fenster-Inhalt ─────────────
app.on("web-contents-created", (_e, wc) => {
  const nurEigene = (e, url) => { if (!istEigeneAdresse(url)) { e.preventDefault(); imBrowserOeffnen(url); } };
  wc.on("will-navigate", (e, url) => nurEigene(e, url));
  wc.on("will-redirect", (e, url) => nurEigene(e, url));
  wc.on("will-frame-navigate", (e) => { if (!istEigeneAdresse(e.url)) e.preventDefault(); });
  wc.on("will-attach-webview", (e) => e.preventDefault());
  wc.setWindowOpenHandler(({ url }) => { imBrowserOeffnen(url); return { action: "deny" }; });
});
// Links aus der Seite: nur http(s) und nur über den Standardbrowser (bei offener Einrichtung nur GitHub und die Anmelde-Domänen, wie die Aktion `extern`)
function imBrowserOeffnen(url) {
  const r = externPruefen(url, { nurHttps: false, einrichtungOffen: aktionen.zustand().einrichtungOffen });
  if (r.ok) shell.openExternal(r.url).catch(() => {});
  else protokoll("link abgelehnt");
}

// ───────────── Laufzeit: das Node der Werkstatt (W2c) ─────────────
// Installierte App: das mitgelieferte Node (resources/node), Kopie samt Kern im Support-Ordner mit stabilen Pfaden (laufzeit.mjs: bin/node für MCP-Einträge und Statuszeile, bin/kern für den MCP-Server).
// Entwicklung (`npm start`): ein absolutes node aus dem PATH; ohne eines startet die Hülle nicht und sagt es (es gibt keinen Notbehelf mit Electron als Node).
function bestimmeLaufzeit() {
  if (app.isPackaged) {
    const l = installiereLaufzeit({ ressourcen: process.resourcesPath, support });
    protokoll(`laufzeit node ${l.version} kern ${l.kern ? "ja" : "nein"}`);
    return { programm: l.nodeDatei, node: l.node, kern: l.kern };
  }
  const node = findeNode(process.env.PATH);
  if (!node) throw new Error("Es gibt kein Node.js im PATH. Zum Entwickeln wird eines gebraucht (die installierte App bringt ihr eigenes mit).");
  return { programm: node, node, kern: null };
}

// ───────────── Updates (W2c) ─────────────
// Nie in der Entwicklung, nie in der Vorschau. Nur im Testlauf der UNVERPACKTEN App ersetzt ein lokaler Dateiserver GitHub (Test des Ablaufs ohne echtes Release); die installierte App hat keinen Schalter
// für die Quelle. Im Testlauf (BRAIN_TESTMODUS) fragt der Updater nicht das Netz und zeigt keine Fenster: die Meldungen landen in `__kortex.update`, die Antworten setzt der Test.
const TEST_FEED = !app.isPackaged && TESTMODUS && /^http:\/\/127\.0\.0\.1:\d+(\/|$)/.test(process.env.KORTEX_TEST_UPDATE_URL || "") ? process.env.KORTEX_TEST_UPDATE_URL : null;
const UPDATES = updatesMoeglich({ gepackt: app.isPackaged, vorschau: !!process.env.KORTEX_VORSCHAU, testFeed: !!TEST_FEED });
const autoUpdater = UPDATES.moeglich ? createRequire(import.meta.url)("electron-updater").autoUpdater : null;
if (autoUpdater) {
  konfiguriere(autoUpdater, { version: app.getVersion(), protokoll });
  if (TEST_FEED) { // wie `app-update.yml` im Paket, nur für den Testlauf der unverpackten App
    const konfig = join(datenOrdner, "test-app-update.yml");
    writeFileSync(konfig, `provider: generic\nurl: ${TEST_FEED}\nupdaterCacheDirName: kortex-test-updater\n`);
    autoUpdater.forceDevUpdateConfig = true;
    autoUpdater.updateConfigPath = konfig;
  }
}
const UPDATE_MELDUNGEN = [];
let updateAntworten = [], updateNeustart = false, updateAuto = () => {};
async function updateMeldung({ titel, text, knoepfe }) {
  if (TESTMODUS) { UPDATE_MELDUNGEN.push({ titel, text, knoepfe: knoepfe ?? null }); return updateAntworten.length ? updateAntworten.shift() : (knoepfe ? knoepfe.length - 1 : 0); }
  const r = await dialog.showMessageBox(...(fenster && !fenster.isDestroyed() ? [fenster] : []), { type: "info", title: "Kortex", message: titel, detail: text, buttons: knoepfe ?? ["OK"], defaultId: 0, cancelId: (knoepfe?.length ?? 1) - 1 });
  return r.response;
}
// Neu starten = Beenden auf dem sicheren Weg (Fenster sichert, Werkstatt endet); den Installer startet erst `before-quit` ganz am Ende
const updater = erzeugeUpdater({ autoUpdater, version: app.getVersion(), aktiv: UPDATES, meldung: updateMeldung, neustart: async () => { updateNeustart = true; app.quit(); }, protokoll });
if (TESTMODUS) globalThis.__kortex = { ...globalThis.__kortex, update: { meldungen: UPDATE_MELDUNGEN, antworten: (a) => { updateAntworten = a; }, neustart: () => updateNeustart, pruefe: (o) => updater.pruefe(o), moeglich: UPDATES.moeglich } };

// ───────────── Start und Ende ─────────────
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => { if (gestartet) zeigeStudio(); }); // während des Hochfahrens kein zweites Fenster
  app.whenReady().then(async () => {
    if (process.platform === "win32") app.setAppUserModelId("io.github.fbrogno.brain"); // wie die Bundle-ID am Mac; der Installer (electron/paket/konfig.mjs: appId) setzt dieselbe
    const ses = session.defaultSession;
    ses.setPermissionRequestHandler((wc, erlaubnis, antwort) => antwort(erlaubnis === "clipboard-sanitized-write" && istEigeneAdresse(wc.getURL())));
    ses.setPermissionCheckHandler((wc, erlaubnis) => erlaubnis === "clipboard-sanitized-write" && !!wc && istEigeneAdresse(wc.getURL()));
    // Die Seite lädt nichts aus dem Netz: nur das eigene Schema (und Daten-/Blob-Adressen, DevTools); alles andere bricht schon hier ab (zusätzlich zur CSP der Werkstatt)
    ses.webRequest.onBeforeRequest((d, antwort) => antwort({ cancel: !/^(kortex|data|blob|devtools):/i.test(d.url) }));
    ses.protocol.handle(SCHEMA, (request) => beantworte(request));
    setzeMenue();

    let laufzeit;
    try { laufzeit = bestimmeLaufzeit(); }
    catch (e) { protokoll(`laufzeit: ${e?.message || e}`); dialog.showErrorBox("Kortex", `Kortex konnte seine Laufzeit nicht bereitstellen.\n\n${String(e?.message || e).slice(0, 600)}`); app.exit(1); return; }
    if (TESTMODUS) globalThis.__kortex.laufzeit = { ...laufzeit };
    bruecke = starteBruecke({
      programm: laufzeit.programm,
      skript: join(RESSOURCEN, "werkstatt", "werkstatt.mjs"),
      vault: optionen.vault,
      env: baueKindUmgebung(process.env, { gepackt: app.isPackaged, node: laufzeit.node, kern: laufzeit.kern, githubClientId: githubClientId(join(RESSOURCEN, "Info.plist")), vorschau: vorschauOrdnerAus(process.env, homedir()) }),
      protokoll,
      beendeBaum,
      // Nach drei Abstürzen in 60 s: sichtbare Meldung mit Neustart statt nur 502 in der Oberfläche
      beiZuvieleAbstuerzen: () => {
        protokoll("werkstatt stürzt immer wieder ab");
        if (TESTMODUS) { globalThis.__kortex.abstuerze = (globalThis.__kortex.abstuerze || 0) + 1; return; }
        dialog.showMessageBox({ type: "error", title: "Kortex", message: "Die Werkstatt von Kortex stürzt immer wieder ab.", detail: "Kortex kann so nicht weiterarbeiten. Deine Notizen sind unverändert. Starte Kortex neu; hilft das nicht, schau in das Protokoll (Support-Ordner, electron/huelle.log).", buttons: ["Neu starten", "Beenden"], defaultId: 0, cancelId: 1 })
          .then(({ response }) => { if (response === 0) app.relaunch(); app.exit(response === 0 ? 0 : 1); });
      },
    });
    // Stirbt die Werkstatt vor dem ersten „bereit“ (kaputter Vault, fehlende Dateien), kommt hier der Grund; die App beendet sich (die Einzelinstanz-Sperre geht mit)
    try { await bruecke.bereit; }
    catch (e) { protokoll(`werkstatt: ${e?.message || e}`); dialog.showErrorBox("Kortex", `Die Werkstatt von Kortex ließ sich nicht starten.\n\n${String(e?.message || e).slice(0, 600)}`); app.exit(1); return; }
    protokoll("werkstatt bereit");
    oeffneFenster();
    gestartet = true;
    // Globale Kürzel, Tray, Mitteilungen: erst jetzt (die Werkstatt läuft). Ein Kürzel, das nicht geht, steht als Hinweis im Erfassen-Fenster.
    kuerzelAnwenden();
    starteTray();
    starteMitteilungen();
    if (process.platform !== "win32") powerMonitor.on("shutdown", (e) => { e.preventDefault(); protokoll("shutdown"); sitzungEnde(); }); // Linux/macOS (Windows: session-end am Fenster)
    if (!TESTMODUS) updateAuto = updater.starteAutomatisch(); // stille Prüfung nach 30 s, dann täglich (nur installiert, nie in der Vorschau)
  });
}
app.on("window-all-closed", () => { if (!bleibtImTray()) app.quit(); });
// Ende: erst die Werkstatt sauber beenden (sie schreibt alle Antworten, nimmt halbe Vorgänge zurück und beendet ihre Kinder), dann die App
app.on("before-quit", (e) => {
  beendet = true; // ab jetzt bleibt die App nicht mehr im Tray, wenn das Fenster zu geht
  if (endeLaeuft || !bruecke) return;
  // Beenden geht über denselben Weg wie Schließen: erst das Fenster (sichert und fragt), dann kommt das Ende hierher zurück
  if (fenster && !schliessenFrei) { e.preventDefault(); fenster.close(); return; }
  endeLaeuft = true;
  e.preventDefault();
  raeumeAuf(); // globale Kürzel freigeben, Tray entfernen (app.exit löst will-quit nicht aus)
  updateAuto();
  bruecke.beende().finally(() => {
    // Update installieren: erst jetzt, wenn Fenster, Werkstatt und Verknüpfungen weg sind (der neue Start soll nicht an der Einzelinstanz-Sperre scheitern)
    if (updateNeustart && app.isPackaged && autoUpdater) {
      app.releaseSingleInstanceLock();
      try { autoUpdater.once("error", () => app.exit(0)); setTimeout(() => app.exit(0), 15_000); autoUpdater.quitAndInstall(true, true); return; } catch (e) { protokoll(`update installieren: ${e?.message || e}`); }
    }
    app.exit(0);
  });
});
