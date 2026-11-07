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

// Windows: os.homedir() liest USERPROFILE; die Tests setzen HOME (wie auf macOS). Ein HOME mit Laufwerksbuchstaben gilt darum auch als Home (Git Bash setzt HOME in MSYS-Form /c/…, das zählt nicht).
import os from "node:os";
const echtHome = os.homedir;
const umgebung = process.env;
os.homedir = () => (/^[A-Za-z]:[\\/]/.test(umgebung.HOME || "") ? umgebung.HOME : echtHome());
syncBuiltinESMExports();

registerHooks({
  resolve(spezifizierer, kontext, weiter) {
    if (/^[A-Za-z]:[\\/]/.test(spezifizierer)) {
      // `…\datei.js?browser`: der Abfrageteil gehört nicht zum Pfad (pathToFileURL würde das ? mitkodieren)
      const q = spezifizierer.indexOf("?");
      const url = pathToFileURL(q < 0 ? spezifizierer : spezifizierer.slice(0, q));
      if (q >= 0) url.search = spezifizierer.slice(q);
      spezifizierer = url.href;
    }
    return weiter(spezifizierer, kontext);
  },
});
