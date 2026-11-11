// electron/pdf.mjs — HTML → PDF in der Electron-Hülle (Aktion `export-pdf`): ein unsichtbares Fenster ohne JavaScript, mit eigener flüchtiger Sitzung, die nichts außer der einen
// Temp-Datei lädt (kein Netz), und `printToPDF` (A4, Seitenränder aus dem @page des HTML). Das HTML bringt Bilder und Schrift als data: mit. Liefert einen Buffer oder null.
import { BrowserWindow, session } from "electron";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";

export async function htmlZuPdf(html, { frist = 60_000 } = {}) {
  const ordner = mkdtempSync(join(tmpdir(), "kortex-pdf-"));
  const datei = join(ordner, "export.html");
  let win = null;
  try {
    writeFileSync(datei, html, { mode: 0o600 });
    const erlaubt = pathToFileURL(datei).href;
    const ses = session.fromPartition(`kortex-pdf-${randomBytes(6).toString("hex")}`); // ohne „persist:“ = flüchtig
    // Windows: Laufwerksbuchstabe und Ordnernamen kommen je nach Quelle in anderer Schreibweise (c:/C:) zurück — dort ohne Groß-/Kleinschreibung vergleichen (R4-8)
    const gleich = (a, b) => (process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b);
    ses.webRequest.onBeforeRequest((d, antwort) => antwort({ cancel: !(gleich(d.url, erlaubt) || d.url.startsWith("data:")) }));
    win = new BrowserWindow({ show: false, width: 794, height: 1123, webPreferences: { session: ses, javascript: false, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true } });
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (e) => e.preventDefault());
    const arbeit = (async () => {
      await win.loadURL(erlaubt); // genau die Adresse, die die Sperre oben erlaubt (loadFile bildet sie selbst und weicht unter Windows ab)
      return win.webContents.printToPDF({ pageSize: "A4", printBackground: true, preferCSSPageSize: true });
    })();
    let uhr;
    const zeit = new Promise((_, nein) => { uhr = setTimeout(() => nein(new Error("pdf-zeit")), frist); });
    try { return await Promise.race([arbeit, zeit]); } finally { clearTimeout(uhr); }
  } catch { return null; }
  finally {
    try { if (win && !win.isDestroyed()) win.destroy(); } catch { /* egal */ }
    try { rmSync(ordner, { recursive: true, force: true }); } catch { /* egal */ }
  }
}
