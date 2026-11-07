// electron/preload.cjs — die EINE Schnittstelle der Seite zur Hülle: window.kortexHuelle = { art, aktionen, aktion(name, wert) } (Hüllen-Vertrag, huellen-vertrag.json).
// Läuft im Sandbox-Preload mit contextIsolation: die Seite sieht nur diese Funktionen, nie ipcRenderer, require oder process. Alles Weitere (Werte prüfen, Rechte der Einrichtung,
// System anfassen) entscheidet der Hauptprozess; hier wird nur weitergereicht. Aktionen mit Dialog oder Dateizugriff antworten als Versprechen, alle anderen sofort
// (synchron), damit `aktion(...)` in api.js wie in der App gleich weiß, ob die Aktion angenommen wurde.
"use strict";
const { contextBridge, ipcRenderer } = require("electron");

const info = ipcRenderer.sendSync("kortex:huelle-info");
const aktionen = Array.isArray(info?.aktionen) ? info.aktionen.map(String) : [];
const asynchron = new Set(Array.isArray(info?.asynchron) ? info.asynchron.map(String) : []);

contextBridge.exposeInMainWorld("kortexHuelle", {
  art: "electron",
  aktionen,
  aktion(name, wert) {
    if (typeof name !== "string") return { ok: false, grund: "unbekannt" };
    if (asynchron.has(name)) return ipcRenderer.invoke("kortex:aktion", name, wert);
    return ipcRenderer.sendSync("kortex:aktion-sync", name, wert);
  },
});
