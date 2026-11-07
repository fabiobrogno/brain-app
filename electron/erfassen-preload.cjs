// electron/erfassen-preload.cjs — die EINE Schnittstelle der Seite „Schnell erfassen“ zur Hülle: window.kortexErfassen (Paket W2b). Sandbox-Preload: lädt nur `electron`; alles Weitere
// (Werte prüfen, Speichern in die Werkstatt, Fenster schließen) entscheidet der Hauptprozess, der nur Aufrufe des eigenen Erfassen-Fensters annimmt.
"use strict";
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("kortexErfassen", {
  /** → { art, vault, hinweis, kuerzel } */
  start: () => ipcRenderer.invoke("erfassen:start"),
  /** { art, text, prioritaet, faellig, erkennePrioritaet, erkenneFaelligkeit } → { ok:true, vault } | { ok:false, text } */
  speichern: (eingabe) => ipcRenderer.invoke("erfassen:speichern", eingabe),
  schliessen: () => { ipcRenderer.send("erfassen:schliessen"); },
  beiZeigen: (f) => { if (typeof f === "function") ipcRenderer.on("erfassen:zeigen", () => f()); },
});
