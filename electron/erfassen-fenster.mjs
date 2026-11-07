// electron/erfassen-fenster.mjs — das Fenster „Schnell erfassen“ (Paket W2b), Gegenstück zu ErfassenSteuerung/ErfassenPanel der Mac-App: klein, rahmenlos, immer oben, nicht in der Taskleiste,
// erscheint oben mittig auf dem Bildschirm mit dem Mauszeiger, schließt bei Esc und bei Fokusverlust. Der Entwurf bleibt stehen (ein Esc darf keinen Gedanken kosten): das Fenster wird nur versteckt.
// Die Seite (electron/erfassen/*) lädt über `kortex://erfassen/`; geredet wird nur über den Preload (erfassen-preload.cjs). Die Logik (Eingabe prüfen, Anfrage bauen, Antwort) steht in erfassen.mjs.
import { BrowserWindow, screen, ipcMain, nativeTheme } from "electron";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { erfassenRahmen, BREITE, HOEHE } from "./erfassen.mjs";

export const ERFASSEN_HOST = "erfassen";
const TYPEN = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
// Was die Seite laden darf: die eigenen drei Dateien und drei Dateien des Studios (Farben, Kurzformen) — nichts sonst
const EIGENE = { "/": "erfassen.html", "/erfassen.js": "erfassen.js", "/erfassen.css": "erfassen.css" };
const STUDIO = { "/s/schemata.css": "schemata.css", "/s/kurzformen.js": "kurzformen.js", "/s/zeit.js": "zeit.js" };

/** Antwort des Schemas `kortex://erfassen/…` → Response (nur die Dateien oben, nur GET/HEAD). ordner = electron/erfassen, studio = Ressourcen/studio. */
export function antwortErfassen(request, { ordner, studio }) {
  const u = new URL(request.url);
  const nein = (status) => new Response(JSON.stringify({ fehler: "nicht gefunden" }), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
  if (!["GET", "HEAD"].includes(request.method)) return nein(405);
  const datei = EIGENE[u.pathname] ? join(ordner, EIGENE[u.pathname]) : STUDIO[u.pathname] ? join(studio, STUDIO[u.pathname]) : null;
  if (!datei) return nein(404);
  let inhalt;
  try { inhalt = readFileSync(datei); } catch { return nein(404); }
  const endung = datei.slice(datei.lastIndexOf("."));
  return new Response(request.method === "HEAD" ? null : inhalt, { status: 200, headers: { "Content-Type": TYPEN[endung], "Cache-Control": "no-store", "Content-Security-Policy": CSP, "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" } });
}

/**
 * abh: { preload, url, bild(): NativeImage|null, entwickler, testmodus, protokoll,
 *        info(): Promise<{art, vault, hinweis, kuerzel}>, speichere(eingabe): Promise<{ok, vault?|text?}> }
 * → { zeigen(), schliessen(), umschalten(), sichtbar(), fenster(), setzeBild(bild), erneuern() }
 */
export function erzeugeErfassenFenster(abh) {
  let win = null, geladen = false, zeigtSeit = 0;
  // Fokusverlust schließt das Fenster (wie ein Spotlight-Feld). Im Testlauf nur mit ausdrücklichem Schalter: unter xvfb ohne Fenstermanager wandert der Fokus von selbst.
  const blurSchliesst = !abh.testmodus || process.env.KORTEX_TEST_ERFASSEN_BLUR === "1";

  const vonSeite = (e) => !!win && !win.isDestroyed() && e.sender === win.webContents && !!e.senderFrame && e.senderFrame === e.sender.mainFrame && e.senderFrame.url.startsWith(`kortex://${ERFASSEN_HOST}/`);
  ipcMain.handle("erfassen:start", async (e) => (vonSeite(e) ? abh.info() : null));
  ipcMain.handle("erfassen:speichern", async (e, eingabe) => (vonSeite(e) ? abh.speichere(eingabe) : { ok: false, text: "Nicht erlaubt." }));
  ipcMain.on("erfassen:schliessen", (e) => { if (vonSeite(e)) schliessen(); });

  function baue() {
    const bild = abh.bild();
    win = new BrowserWindow({
      width: BREITE, height: HOEHE, useContentSize: true, show: false, frame: false, resizable: false, minimizable: false, maximizable: false, fullscreenable: false, alwaysOnTop: true, skipTaskbar: true,
      title: "Schnell erfassen", backgroundColor: nativeTheme.shouldUseDarkColors ? "#0a0a0a" : "#ffffff", ...(bild ? { icon: bild } : {}), ...(process.platform === "darwin" ? { type: "panel" } : {}),
      webPreferences: { preload: abh.preload, contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, allowRunningInsecureContent: false, webviewTag: false, devTools: abh.entwickler },
    });
    win.setAlwaysOnTop(true, "floating");
    if (process.platform !== "darwin") win.removeMenu();
    geladen = false;
    win.webContents.once("did-finish-load", () => { geladen = true; });
    win.on("blur", () => { if (blurSchliesst && win?.isVisible() && Date.now() - zeigtSeit > 250) schliessen(); });
    win.on("closed", () => { win = null; geladen = false; });
    win.loadURL(abh.url).catch((e) => abh.protokoll(`erfassen laden: ${e?.message || e}`));
  }

  function zeigen() {
    const neu = !win || win.isDestroyed();
    if (neu) baue();
    const ort = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    win.setBounds(erfassenRahmen(ort)); // useContentSize: Breite und Höhe bleiben die der Seite
    zeigtSeit = Date.now();
    const los = () => { if (!win || win.isDestroyed()) return; win.show(); win.focus(); if (geladen) win.webContents.send("erfassen:zeigen"); };
    if (neu && !geladen) win.once("ready-to-show", los); else los();
  }
  function schliessen() {
    if (win && !win.isDestroyed() && win.isVisible()) win.hide(); // der Entwurf bleibt in der Seite stehen
  }
  return {
    zeigen, schliessen,
    umschalten() { if (win && !win.isDestroyed() && win.isVisible()) schliessen(); else zeigen(); },
    sichtbar: () => !!win && !win.isDestroyed() && win.isVisible(),
    fenster: () => (win && !win.isDestroyed() ? win : null),
    setzeBild(bild) { if (win && !win.isDestroyed() && bild) win.setIcon(bild); },
    /** Das Kürzel oder der Hinweis hat sich geändert: die Seite liest neu (nur wenn sie schon da ist). */
    erneuern() { if (win && !win.isDestroyed() && geladen) win.webContents.send("erfassen:zeigen"); },
  };
}
