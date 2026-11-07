// electron/haupt.mjs — Hauptprozess der Kortex-Hülle für Windows und Linux (Paket W2a; am Mac läuft weiter die Swift-App).
// Aufbau: Die Werkstatt (Ressourcen/werkstatt/werkstatt.mjs, dieselbe Datei wie in der Swift-App) läuft als KINDPROZESS und spricht das Zeilenprotokoll (bruecke.mjs).
// Das Studio lädt über das eigene Schema `kortex://studio/` (protocol.handle → Brücke): kein Port, kein Token, kein Netzwerkweg zur Werkstatt. Die Seite sieht nur
// `window.kortexHuelle` (preload.cjs); die Aktionen des Hüllen-Vertrags setzt aktionen.mjs um, geprüft wird im Hauptprozess.
// Nicht in diesem Paket: Tray, Erfassen-Fenster, globale Kürzel, Installer, Updater (W2b/W2c, docs/plaene/plattformen-windows-linux.md).
import { app, BrowserWindow, Menu, Notification, clipboard, dialog, ipcMain, nativeTheme, protocol, session, shell } from "electron";
import { appendFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join, isAbsolute } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { erzeugeAktionen, ASYNCHRON } from "./aktionen.mjs";
import { starteBruecke, baueKindUmgebung } from "./bruecke.mjs";
import { SCHEMA, HOST, START_URL, istEigeneAdresse, externPruefen } from "./navigation.mjs";

const HIER = dirname(fileURLToPath(import.meta.url));
// Ressourcen des Repos (Studio, Werkstatt, gemeinsam): im Repo ../Ressourcen, im Paket (W2c) <resources>/Ressourcen
const RESSOURCEN = app.isPackaged ? join(process.resourcesPath, "Ressourcen") : join(HIER, "..", "Ressourcen");
const laden = (rel) => import(pathToFileURL(join(RESSOURCEN, rel)).href);
const { supportOrdner } = await laden("gemeinsam/plattform.mjs");
const { pruefeOrdner, pruefeGit, gitInstallHinweis, leseEinrichtung, schreibeEinrichtung } = await laden("werkstatt/browser-ordner.mjs");

const ENTWICKLER = !app.isPackaged || process.env.KORTEX_ENTWICKLER === "1";
const MAX_KOERPER = 64 * 1024 * 1024;
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

let fenster = null, bruecke = null, endeLaeuft = false;
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
  mitteilung: ({ titel, text }) => { if (!Notification.isSupported()) return false; new Notification({ title: titel, body: text }).show(); return true; },
  darstellung: (quelle) => { nativeTheme.themeSource = quelle; },
  fensterTitel: (text) => { fenster?.setTitle(text || "Kortex"); },
  fensterZoom: () => { if (!fenster) return; if (fenster.isMaximized()) fenster.unmaximize(); else fenster.maximize(); },
  befehlAnStudio,
  protokoll,
  einrichtung: { lese: leseEinrichtung, schreibe: schreibeEinrichtung },
  ordner: { pruefeOrdner },
  git: { pruefen: () => pruefeGit(), hinweis: () => gitInstallHinweis() },
});

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
  catch { return antwortJson(502, { fehler: "Die Werkstatt antwortet nicht." }); }
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
    width: 1280, height: 860, minWidth: 720, minHeight: 480, show: false, title: "Kortex", autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#16181c" : "#ffffff",
    webPreferences: {
      preload: join(HIER, "preload.cjs"),
      contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true,
      allowRunningInsecureContent: false, webviewTag: false, devTools: ENTWICKLER,
    },
  });
  const wc = fenster.webContents;
  fenster.once("ready-to-show", () => fenster?.show());
  fenster.on("closed", () => { fenster = null; });
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
  const bereit = await fenster.webContents.executeJavaScript(
    `new Promise((ok) => { if (window.__studioBereit) return ok(true); addEventListener("studio-bereit", () => ok(true), { once: true }); setTimeout(() => ok(false), 20000); })`);
  if (!bereit) return;
  if ((await vaultPfad()) === null && !leseEinrichtung(support).ende) aktionen.aktion("einrichtung-oeffnen", {});
}

// Menü: Win/Linux nur „Ansicht“ (Zoom, Vollbild; ohne Bearbeiten-Menü: Strg+C/V/Z gehören dem Editor), Mac für die Entwicklung mit den Standardeinträgen. Richtige Menüs und Kürzel: W2b.
function baueMenue() {
  const ansicht = { label: "Ansicht", submenu: [{ role: "zoomIn" }, { role: "zoomOut" }, { role: "resetZoom" }, { type: "separator" }, { role: "togglefullscreen" }, ...(ENTWICKLER ? [{ type: "separator" }, { role: "toggleDevTools" }] : [])] };
  if (process.platform === "darwin") return Menu.buildFromTemplate([{ role: "appMenu" }, { role: "editMenu" }, ansicht, { role: "windowMenu" }]);
  return Menu.buildFromTemplate([ansicht]);
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

// ───────────── Start und Ende ─────────────
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => { if (fenster) { if (fenster.isMinimized()) fenster.restore(); fenster.focus(); } });
  app.whenReady().then(async () => {
    if (process.platform === "win32") app.setAppUserModelId("io.github.fbrogno.brain"); // wie die Bundle-ID am Mac; der Installer (W2c) setzt dieselbe
    const ses = session.defaultSession;
    ses.setPermissionRequestHandler((wc, erlaubnis, antwort) => antwort(erlaubnis === "clipboard-sanitized-write" && istEigeneAdresse(wc.getURL())));
    ses.setPermissionCheckHandler((wc, erlaubnis) => erlaubnis === "clipboard-sanitized-write" && !!wc && istEigeneAdresse(wc.getURL()));
    // Die Seite lädt nichts aus dem Netz: nur das eigene Schema (und Daten-/Blob-Adressen, DevTools); alles andere bricht schon hier ab (zusätzlich zur CSP der Werkstatt)
    ses.webRequest.onBeforeRequest((d, antwort) => antwort({ cancel: !/^(kortex|data|blob|devtools):/i.test(d.url) }));
    ses.protocol.handle(SCHEMA, (request) => beantworte(request));
    Menu.setApplicationMenu(baueMenue());

    bruecke = starteBruecke({
      programm: process.execPath,
      skript: join(RESSOURCEN, "werkstatt", "werkstatt.mjs"),
      vault: optionen.vault,
      env: baueKindUmgebung(process.env),
      protokoll,
    });
    try { await bruecke.bereit; }
    catch (e) { protokoll(`werkstatt: ${e?.message || e}`); dialog.showErrorBox("Kortex", "Die Werkstatt von Kortex ließ sich nicht starten."); app.exit(1); return; }
    oeffneFenster();
  });
}
app.on("window-all-closed", () => app.quit());
// Ende: erst die Werkstatt sauber beenden (sie schreibt alle Antworten, nimmt halbe Vorgänge zurück und beendet ihre Kinder), dann die App
app.on("before-quit", (e) => {
  if (endeLaeuft || !bruecke) return;
  endeLaeuft = true;
  e.preventDefault();
  bruecke.beende().finally(() => app.exit(0));
});
