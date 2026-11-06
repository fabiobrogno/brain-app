// Nur Windows (teste-node.sh lädt das mit --import): `await import(pfad(...))` bekommt dort einen Laufwerkspfad (D:\...), den node nicht als Modul-Adresse
// akzeptiert („On Windows, absolute paths must be valid file:// URLs“). Dieser Haken macht aus einem absoluten Windows-Pfad eine file://-Adresse.
// Auf macOS/Linux wird die Datei nie geladen.
import { registerHooks, syncBuiltinESMExports } from "node:module";
import { pathToFileURL } from "node:url";
import fs from "node:fs";

// Windows legt Temp-Ordner in Kurzform an (C:\Users\RUNNER~1\…); git und andere Programme melden die lange. fs.realpathSync (JS) löst Kurznamen nicht auf, die .native-Fassung schon.
// Für die ganze Testsuite gilt darum überall die .native-Fassung (nur Windows, nur Tests; die App selbst ruft dort .native an den Stellen, an denen es zählt).
const nativ = fs.realpathSync.native;
fs.realpathSync = Object.assign((p, o) => nativ(p, o), { native: nativ });
syncBuiltinESMExports();

registerHooks({
  resolve(spezifizierer, kontext, weiter) {
    if (/^[A-Za-z]:[\\/]/.test(spezifizierer)) spezifizierer = pathToFileURL(spezifizierer).href;
    return weiter(spezifizierer, kontext);
  },
});
