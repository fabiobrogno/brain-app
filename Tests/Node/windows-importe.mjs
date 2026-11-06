// Nur Windows (teste-node.sh lädt das mit --import): `await import(pfad(...))` bekommt dort einen Laufwerkspfad (D:\...), den node nicht als Modul-Adresse
// akzeptiert („On Windows, absolute paths must be valid file:// URLs“). Dieser Haken macht aus einem absoluten Windows-Pfad eine file://-Adresse.
// Auf macOS/Linux wird die Datei nie geladen.
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";

registerHooks({
  resolve(spezifizierer, kontext, weiter) {
    if (/^[A-Za-z]:[\\/]/.test(spezifizierer)) spezifizierer = pathToFileURL(spezifizierer).href;
    return weiter(spezifizierer, kontext);
  },
});
