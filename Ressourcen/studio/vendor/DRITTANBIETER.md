# Drittanbieter-Software in `vendor/`

`codemirror.bundle.js` ist ein einmal mit esbuild gebautes Bündel aus CodeMirror 6 (Quelle: `Werkzeuge/editor-bundle/`,
Neubau: `cd Werkzeuge/editor-bundle && npm install && npm run bauen`). Es wird ohne Build-Schritt zur Laufzeit geladen.

| Paket | Version | Lizenz |
|---|---|---|
| @codemirror/state | 6.7.6 | MIT |
| @codemirror/view | 6.43.15 | MIT |
| @codemirror/commands | 6.11.1 | MIT |
| @codemirror/language | 6.13.1 | MIT |
| @codemirror/lang-markdown | 6.5.2 | MIT |
| @codemirror/autocomplete | 6.20.4 | MIT |
| @codemirror/search | 6.7.2 | MIT |
| @lezer/highlight (und weitere @lezer/*, @marijn/*, style-mod, w3c-keyname, crelt als Abhängigkeiten) | 1.2.5 | MIT |

Copyright © Marijn Haverbeke und Mitwirkende. MIT-Lizenztext: https://github.com/codemirror/dev/blob/main/LICENSE
