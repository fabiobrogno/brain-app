# Hinweise zu Software und Material von Dritten

Kortex selbst steht unter der MIT-Lizenz (siehe `LICENSE`, Copyright 2026 Fabio Brogno). Die fertige App liefert zusätzlich die
folgenden Bestandteile anderer Urheber mit. Dieser Text gehört zur App (im Paket: `Kortex.app/Contents/Resources/THIRD-PARTY-NOTICES.md`)
und ist in Kortex unter Einstellungen (Zahnrad) → „Lizenzen …“ lesbar.

Die App enthält **keine** npm-Pakete zur Laufzeit: Es gibt kein `node_modules` im Paket. Die Editor-Bibliothek ist ein einmal
vorab gebautes Bündel (siehe CodeMirror).

| Bestandteil | Version | Lizenz | Ort im Paket |
|---|---|---|---|
| Node.js (gebündelte Laufzeit) | v24.22.0 | MIT (mit eigenen Lizenzen der enthaltenen Bibliotheken) | `node-runtime/bin/node`, `node-runtime/LICENSE` |
| Sparkle (Update-Framework) | 2.10.0 | MIT (mit eigenen Lizenzen einzelner Quelldateien) | `Frameworks/Sparkle.framework` |
| CodeMirror 6 und Lezer (Editor) | siehe unten | MIT | `studio/vendor/codemirror.bundle.js` |
| three.js (3D-Ansicht) | r170 | MIT | `kern/ansicht/vendor/three.bundle.js` |
| Geist und Geist Mono (Schriften) | Variable | SIL Open Font License 1.1 | `kern/ansicht/vendor/fonts/`, `studio/vendor/fonts/` |
| Gehirnoberfläche (aus AOMIC-ID1000) | 1.2.1 | CC0 1.0 | `kern/ansicht/vendor/brain-mesh/brain-mesh.js` |
| Simple Icons (Logos der KI-Programme und Dienste) | 16.36.0 | CC0 1.0 | `logos/`, `studio/ki-katalog.js`, `studio/marken.js` |
| Logos weiterer KI-Programme (Marken der Inhaber, nur zur Kennzeichnung) | abgerufen 30.10.2026 | Marke des Inhabers | `logos/`, `studio/ki-katalog.js` (Quelle je Datei: `logos/HERKUNFT.md`) |
| Simple Icons (MCP-Logos der 3D-Ansicht) | 16.33.0 | CC0 1.0 | `kern/ansicht/vendor/icons/` |
| Orca (Gestaltungsmuster und -werte: Dialoge, Einrichtung, leere Zustände, Design-System v2; Liste der KI-Programme) | Commits cf5b462, 9bccd67 | MIT | `studio/studio.css`, `studio/bausteine.css`, `studio/dialoge.css`, `studio/aufgaben.css`, `studio/hilfen.js`, `studio/willkommen.js` (Gestaltung; Oberfläche der App: `EinrichtungsBausteine.swift`), `gemeinsam/ki-katalog.json` (Programmliste) |

Die Pfade sind relativ zu `Kortex.app/Contents/Resources`, außer Sparkle (relativ zu `Kortex.app/Contents`).

## Node.js v24.22.0

Kortex bringt die offizielle Node.js-Laufzeit für macOS (arm64) mit. Sie wird beim Bauen von nodejs.org geladen und gegen die
veröffentlichte SHA-256-Summe geprüft (`scripts/hole-node.sh`, Version in `scripts/node-version.txt`), nicht verändert und mit
ihrer Entitlement-Datei neu signiert. Projekt: https://nodejs.org · Quelltext: https://nodejs.org/dist/v24.22.0/

Node.js steht unter der MIT-Lizenz. Der **vollständige Lizenztext** von Node.js samt den Lizenzen der darin enthaltenen
Bibliotheken (V8, OpenSSL, ICU, zlib, undici und weitere) liegt im Paket unter `Contents/Resources/node-runtime/LICENSE`.
Der Kern davon:

```
Copyright Node.js contributors. All rights reserved.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation
files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy,
modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

## Sparkle 2.10.0

Kortex prüft mit dem Framework Sparkle auf Updates (Menü „Nach Updates suchen …“). Sparkle liegt unverändert als
`Frameworks/Sparkle.framework` im Paket. Projekt: https://sparkle-project.org · Quelltext: Sparkle 2.10.0 auf der Seite des
Projekts sparkle-project. Die Lizenz von Sparkle samt den Lizenzen der eingebundenen Quelldateien (bsdiff, sais-lite, Ed25519,
SUSignatureVerifier) im Wortlaut:

```
Copyright (c) 2006-2013 Andy Matuschak.
Copyright (c) 2009-2013 Elgato Systems GmbH.
Copyright (c) 2011-2014 Kornel Lesiński.
Copyright (c) 2015-2017 Mayur Pawashe.
Copyright (c) 2014 C.W. Betts.
Copyright (c) 2014 Petroules Corporation.
Copyright (c) 2014 Big Nerd Ranch.
All rights reserved.

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

=================
EXTERNAL LICENSES
=================

bspatch.c and bsdiff.c, from bsdiff 4.3 <http://www.daemonology.net/bsdiff/>:

Copyright 2003-2005 Colin Percival
All rights reserved

Redistribution and use in source and binary forms, with or without
modification, are permitted providing that the following conditions 
are met:
1. Redistributions of source code must retain the above copyright
   notice, this list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright
   notice, this list of conditions and the following disclaimer in the
   documentation and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE AUTHOR ``AS IS'' AND ANY EXPRESS OR
IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
ARE DISCLAIMED.  IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY
DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS
OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION)
HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT,
STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING
IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
POSSIBILITY OF SUCH DAMAGE.

--

sais.c and sais.h, from sais-lite (2010/08/07) <https://sites.google.com/site/yuta256/sais>:

The sais-lite copyright is as follows:

Copyright (c) 2008-2010 Yuta Mori All Rights Reserved.

Permission is hereby granted, free of charge, to any person
obtaining a copy of this software and associated documentation
files (the "Software"), to deal in the Software without
restriction, including without limitation the rights to use,
copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the
Software is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
OTHER DEALINGS IN THE SOFTWARE.

--

Portable C implementation of Ed25519, from https://github.com/orlp/ed25519

Copyright (c) 2015 Orson Peters <orsonpeters@gmail.com>

This software is provided 'as-is', without any express or implied warranty. In no event will the
authors be held liable for any damages arising from the use of this software.

Permission is granted to anyone to use this software for any purpose, including commercial
applications, and to alter it and redistribute it freely, subject to the following restrictions:

1. The origin of this software must not be misrepresented; you must not claim that you wrote the
   original software. If you use this software in a product, an acknowledgment in the product
   documentation would be appreciated but is not required.

2. Altered source versions must be plainly marked as such, and must not be misrepresented as
   being the original software.

3. This notice may not be removed or altered from any source distribution.

--

SUSignatureVerifier.m:

Copyright (c) 2011 Mark Hamlin.

All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted providing that the following conditions
are met:
1. Redistributions of source code must retain the above copyright
   notice, this list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright
   notice, this list of conditions and the following disclaimer in the
   documentation and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE AUTHOR ``AS IS'' AND ANY EXPRESS OR
IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
ARE DISCLAIMED.  IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY
DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS
OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION)
HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT,
STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING
IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
POSSIBILITY OF SUCH DAMAGE.
```

## CodeMirror 6 und Lezer (Markdown-Editor)

`studio/vendor/codemirror.bundle.js` ist ein einmal mit esbuild gebautes Bündel (Quelle und Neubau: `Werkzeuge/editor-bundle/`, ohne
Änderungen am Quelltext der Pakete). Enthalten sind die Pakete (alle MIT): @codemirror/state 6.7.6, @codemirror/view 6.43.15,
@codemirror/commands 6.11.1, @codemirror/language 6.13.1, @codemirror/lang-markdown 6.5.2, @codemirror/lang-html 6.4.12,
@codemirror/lang-css 6.3.1, @codemirror/lang-javascript 6.2.5, @codemirror/lint 6.9.7, @codemirror/autocomplete 6.20.4,
@codemirror/search 6.7.2, @lezer/common 1.5.4, @lezer/highlight 1.2.5, @lezer/lr 1.4.11, @lezer/markdown 1.8.1, @lezer/html 1.3.13,
@lezer/css 1.3.9, @lezer/javascript 1.5.6, @marijn/find-cluster-break 1.0.4, crelt 1.0.7, style-mod 4.1.4, w3c-keyname 2.2.8.
Projekt: https://codemirror.net

```
MIT License

Copyright (C) Marijn Haverbeke <marijn@haverbeke.berlin> and others

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files
(the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE
FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

## three.js r170

Datei: `kern/ansicht/vendor/three.bundle.js` (gebündelt mit OrbitControls, EffectComposer, UnrealBloomPass, OutputPass, MarchingCubes).
Lizenztext auch als `kern/ansicht/vendor/three.LICENSE.txt`. Projekt: https://threejs.org

```
The MIT License

Copyright © 2010-2024 three.js authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

## Geist und Geist Mono (Schriften)

Dateien: `kern/ansicht/vendor/fonts/Geist-Variable.woff2`, `kern/ansicht/vendor/fonts/GeistMono-Variable.woff2` (3D-Ansicht) und dieselben Dateien unter
`studio/vendor/fonts/` (Studio, per `@font-face` mit relativer URL, ohne Zugriff von außen). Lizenztext auch als `kern/ansicht/vendor/fonts/OFL.txt` und
`studio/vendor/fonts/OFL.txt`. Projekt: Geist von Vercel (Repository „geist-font“).

```
Copyright (c) 2023 Vercel, in collaboration with basement.studio

This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is copied below, and is also available with a FAQ at:
http://scripts.sil.org/OFL

-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION AND CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
```

## Gehirnoberfläche der 3D-Ansicht (CC0 1.0)

Datei: `kern/ansicht/vendor/brain-mesh/brain-mesh.js`, abgeleitet aus dem Datensatz AOMIC-ID1000 (OpenNeuro ds003097, Version 1.2.1,
Proband sub-0001). Der Datensatz steht unter CC0 1.0 (https://creativecommons.org/publicdomain/zero/1.0/). Abgeleitet wurden nur
Geometrie, Sulkustiefe, Kurvatur und die Lappen-Zuordnung, keine Bilddaten und keine personenbezogenen Daten. Auf Wunsch der Autoren
zitiert: Snoek, L. et al. (2021), *The Amsterdam Open MRI Collection, a set of multimodal MRI datasets for individual difference
analyses*, Scientific Data 8, 85. https://doi.org/10.1038/s41597-021-00870-6 · Herkunft im Detail:
`kern/ansicht/vendor/brain-mesh/LICENSE-SOURCE.md`.

## Simple Icons: Logos (CC0 1.0) und Markenhinweis

Die Logos der KI-Programme und Dienste stammen aus dem Projekt Simple Icons (https://simpleicons.org), Version 16.36.0, unverändert
bis auf die gekürzten Dateinamen. Die SVG-Daten des Projekts stehen unter CC0 1.0 (Lizenztext im Paket:
`logos/LIZENZ-simple-icons-CC0.md`, Herkunft und Darstellung: `logos/HERKUNFT.md`). Dateien: claude.svg, copilot.svg, cursor.svg,
gemini.svg, github.svg, opencode.svg, warp.svg, zed.svg, dazu aus Simple Icons kimi, trae, qwen-code, rovo und muse (Dateien in `logos/`,
Zuordnung in `logos/HERKUNFT.md`), LIZENZ-simple-icons-CC0.md, HERKUNFT.md. Die Zeichnungen stehen unverändert auch in
`studio/ki-katalog.js` (erzeugt) und `studio/marken.js`.

Die Logos der übrigen KI-Programme im Katalog (`gemeinsam/ki-katalog.json`, rund 40 Terminal-KIs, Editoren und Apps) wurden einmalig von der
offiziellen Seite des jeweiligen Produkts bzw. von der Datei geholt, die diese Seite selbst als Symbol angibt (Adresse und Datum je Datei in
`logos/HERKUNFT.md`), gesäubert (keine Skripte, keine Verweise nach außen) und beschnitten bzw. auf eine Fläche reduziert. Kortex lädt nie
ein Logo aus dem Netz. Es sind Marken ihrer Inhaber (siehe unten); die Dateien stehen nicht unter CC0. Alle Logo-Dateien des Ordners `logos/`: aider.png, amp.svg, ante.svg, antigravity.svg, aug.svg, autohand.svg, claude.svg, cline.svg, codebuddy.svg, codebuff.png, codex.svg, command-code.svg, continue.png, copilot.svg, cursor.svg, devin.svg, droid.svg, freebuff.png, gemini.svg, github.svg, goose.png, grok.svg, jcode.svg, kilo.svg, kimi.svg, kiro.svg, mistral-vibe.svg, muse.svg, omp.svg, openclaude.svg, openclaw.svg, opencode.svg, pi.svg, prime-agent.png, qoder.png, qwen-code.svg, rovo.svg, trae.svg, vscode.png, warp.svg, windsurf.svg, zcode.png, zed.svg.

Die MCP-Logos der 3D-Ansicht (`kern/ansicht/vendor/icons/`, Simple Icons 16.33.0, 46 Symbole, CC0 1.0; Zuordnung in `zuordnung.json`,
Herkunft in `LIZENZ.md`) sind: airtable.svg, anthropic.svg, asana.svg, claude.svg, cloudflare.svg, confluence.svg, discord.svg,
docker.svg, dropbox.svg, figma.svg, github.svg, gitlab.svg, gmail.svg, google.svg, googleanalytics.svg, googlecalendar.svg,
googlechrome.svg, googledocs.svg, googledrive.svg, googlemeet.svg, googlesheets.svg, hubspot.svg, jira.svg, kubernetes.svg,
linear.svg, meta.svg, miro.svg, mongodb.svg, mysql.svg, n8n.svg, nginx.svg, notion.svg, postgresql.svg, redis.svg, sentry.svg,
shopify.svg, spotify.svg, stripe.svg, supabase.svg, telegram.svg, trello.svg, vercel.svg, whatsapp.svg, youtube.svg, zapier.svg,
zoom.svg.

**Marken.** CC0 gilt für die Zeichnungen, nicht für die dargestellten Marken. Alle Namen, Logos und Marken gehören ihren Inhabern
(unter anderen Anthropic, OpenAI, Anysphere (Cursor), Google, GitHub/Microsoft, Zed Industries, OpenCode, Warp und die Anbieter der
MCP-Dienste). Kortex nutzt sie nur, um Programme und Dienste zu kennzeichnen, mit denen es sich verbindet. **Kortex ist mit keinem dieser
Unternehmen verbunden und wird von ihnen weder empfohlen noch unterstützt.** Das OpenAI-Zeichen (für Codex) stammt von `developers.openai.com`; OpenAI hat keine Freigabe erteilt, Kortex nutzt es nur zur Kennzeichnung und nimmt es auf Wunsch des Inhabers heraus (Begründung: `logos/HERKUNFT.md`).

## Orca (Gestaltungsmuster, MIT)

Die Gestaltung der Einrichtung, der Dialoge und der leeren Zustände in Kortex folgt dem Vorbild der Desktop-App **Orca** (https://github.com/stablyai/orca,
Website https://orca.dev), Stand Commit `cf5b462fba8462678256b25d05cec2adb8dca412` (Dialoge, Einrichtung) und Commit `9bccd6795593abbe47dfebc7c2df5393712ce69c`
(Design-System v2; Hauptzweig, 30. Oktober 2026). Es ist kein Quelltext kopiert: Maße, Aufbau und Abläufe wurden von Hand nach CSS, Vanilla-JavaScript und SwiftUI übertragen, mit eigenen Texten, eigenen Farben
(Kortex-Akzent) und eigenen Symbolen. Übernommen sind:

- das Aufbaumuster eines Dialogs (Titel, ein Satz Beschreibung, Inhalt, Fußleiste rechtsbündig mit dem Hauptknopf; 24 px Innenabstand, 16 px Abstand
  zwischen den Teilen, 8 px zwischen den Knöpfen; Enter bestätigt, Esc schließt; Enter-Hinweis am Hauptknopf) nach
  `src/renderer/src/components/ui/dialog.tsx` und `src/renderer/src/components/onboarding/OnboardingFooter.tsx`
  → `studio/dialoge.css`, `studio/hilfen.js` (`dialog()`), `Sources/BrainApp/EinrichtungsAssistent.swift` (Fußleiste);
- das Muster „eine große Hauptaktion, darunter eine gruppierte Liste weiterer Wege, gewählte Zeile mit Rahmen und Enter-Hinweis, Pfeiltasten
  wechseln die Zeile“ samt Zeilenmaßen (Symbolkachel 28 px mit 6 px Ecke, Titel 14 px, Beschreibung 12 px, Gruppenüberschrift in Großbuchstaben mit
  Sperrung) nach `src/renderer/src/components/sidebar/AddRepoStartSteps.tsx`
  → `studio/willkommen.js` und `studio/dialoge.css` („Andere Wege“), `Sources/BrainApp/EinrichtungsBausteine.swift` (`WegZeile`, `WegGruppe`);
- die Liste der KI-Programme (Terminal-KIs mit Erkennungsbefehl und Ersatznamen, Reihenfolge, Webseiten) und das Muster „gefundene bzw. beliebte KIs als Karten, weitere zum Aufklappen“ nach
  `src/shared/tui-agent-config.ts`, `src/shared/tui-agent-favicon-domains.ts`, `src/renderer/src/lib/agent-catalog-entries-*.ts` und
  `src/renderer/src/components/onboarding/AgentStep.tsx` (Stand @9bccd67) → `gemeinsam/ki-katalog.json`, `studio/bausteine.js` (`kiAuswahl()`),
  `Sources/BrainCore/KiKatalog.swift`; die Programmlogos von Orca (`agent-icons`) sind nicht übernommen;
- der leere Zustand als Kreis (48 px) mit Symbol, einem kurzen Satz und höchstens einer Aktion nach
  `src/renderer/src/components/native-chat/NativeChatEmptyState.tsx` → `studio/dialoge.css`, `studio/bausteine.js` (`leerBlock()`);
- die Gestaltungswerte des Design-Systems v2 (Graustufen hell/dunkel, Ränder 7 % und 13 %, Radius-Skala aus `--radius: 0.625rem`, die drei Höhenstufen
  Haarlinie, `shadow-xs` und `shadow-floating` samt Dialogschatten, die Auswahl-Regel für Listenzeilen, Typo-Skala und `letter-spacing: 0.01em`, die Bewegungskurven und -dauern, Maße von
  Knopf, Feld, Schalter und Segment) nach `src/renderer/src/assets/main.css`, `docs/STYLEGUIDE.md` und `src/renderer/src/components/ui/*.tsx`
  → `studio/studio.css` (Tokens), `studio/bausteine.css`, `studio/dialoge.css`, `studio/aufgaben.css`; der Text-Schimmer für laufende Vorgänge (`assets/text-shimmer.css` in Orca,
  dort aus shadcn/ui, MIT: https://github.com/shadcn-ui/ui) ist neu geschrieben (`bausteine.css`, `.bs-text-schimmer`).

- die Seite „Einstellungen“: ganzflächig mit eigener Seitenleiste (Suche oben, Gruppen in Großbuchstaben, „Zurück zur App“), Zeile mit Titel und Beschreibung links und Steuerung rechts,
  Bereich als Karte, Themenkarten mit Fenster-Vorschau, sofort speichern (Textfelder 700 ms verzögert), Sprungziel leuchtet kurz auf, und die Wertung der Einstellungssuche
  (Bereichsname 900/850/800, Titel 700/650/600, Beschreibung 500/450/400, Stichwörter 300/250/200; genau, beginnt mit, enthält) nach
  `src/renderer/src/components/settings/Settings.tsx`, `SettingsSidebar.tsx`, `SettingsFormControls.tsx`, `settings-search.ts` und `components/onboarding/ThemeStep.tsx`
  → `studio/einstellungen.js`, `studio/einstellungen.css`, `studio/einstellungen-suche.js` (die Wertung ist in JavaScript neu geschrieben, nichts kopiert), `studio/bausteine.js` (Zeilen-Bausteine).

Orca ist MIT-lizenziert. Lizenztext (Copyright-Zeile wie in der Datei `LICENSE` von Orca):

```
MIT License

Copyright (c) 2026 Lovecast Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Name, Marke und Logo von Orca sind nicht übernommen; Kortex ist mit Orca nicht verbunden. Die Muster aus dem Projekt Tolaria
(https://github.com/refactoringhq/tolaria, AGPL-3.0) sind nur als Prinzipien in `docs/plaene/design-wizards.md` beschrieben, es wurde nichts
daraus übernommen.

## Nicht mitgeliefert

Git, Claude Code, Codex und die anderen KI-Programme werden nicht mit Kortex ausgeliefert. Kortex benutzt, was auf deinem Mac
installiert ist. Das App-Symbol und die Oberfläche von Kortex sind eigene Arbeit (MIT), mit den oben genannten Gestaltungsmustern von Orca (MIT).
