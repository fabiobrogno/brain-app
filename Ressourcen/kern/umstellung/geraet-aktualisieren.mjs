#!/usr/bin/env node
// umstellung/geraet-aktualisieren.mjs — erneuert die Kortex-Version im Gerätemerker dieses Macs (siehe geraete.mjs#aktualisiereGeraetemerker). Aufruf: geraet-aktualisieren.mjs <vault>
// Läuft im Hintergrund-Teil jedes Sitzungsstarts (session-hintergrund.mjs); schreibt höchstens eine Datei im Vault und gibt nie einen Fehler zurück.
import { resolve } from "node:path";
const vault = process.argv[2];
if (vault) {
  try {
    const { echteZiele } = await import("./ziele.mjs");
    const { aktualisiereGeraetemerker } = await import("./geraete.mjs");
    aktualisiereGeraetemerker(echteZiele({ vault: resolve(vault) }));
  } catch { /* nie ein Fehler nach außen */ }
}
