# Herkunft der Marken-Logos

Die Logos dienen nur dazu, KI-Apps und Dienste zu kennzeichnen, mit denen Kortex sich verbindet (Claude, Cursor, GitHub).

**Marken gehören den jeweiligen Inhabern, Nutzung nur zur Kennzeichnung der Integration.** Kortex ist weder mit Anthropic, OpenAI, Anysphere (Cursor), Google, GitHub/Microsoft, Zed Industries, dem OpenCode-Projekt noch Warp verbunden und wird von ihnen nicht empfohlen oder unterstützt. Die Logos werden nicht verändert (keine Verzerrung, kein Umfärben der Form; dargestellt wird in der Markenfarbe oder einfarbig in der Textfarbe, siehe „Darstellung“).

| Datei | KI-App | Quelle | Version | Lizenz der SVG-Daten | Abgerufen |
|---|---|---|---|---|---|
| `claude.svg` | Claude Code und Claude Desktop (Anthropic) | Simple Icons, `icons/claude.svg` (Marke: https://claude.ai), Markenfarbe `#D97757` | simple-icons 16.36.0 (npm) | CC0 1.0 | 2026-10-29 |
| `cursor.svg` | Cursor (Anysphere) | Simple Icons, `icons/cursor.svg` (Marke: https://cursor.com/brand), einfarbig | simple-icons 16.36.0 (npm) | CC0 1.0 | 2026-10-29 |
| `gemini.svg` | Gemini CLI (Google) | Simple Icons, `icons/googlegemini.svg`, Markenfarbe `#8E75B2` | simple-icons 16.36.0 (npm) | CC0 1.0 | 2026-10-30 |
| `copilot.svg` | GitHub Copilot (GitHub) | Simple Icons, `icons/githubcopilot.svg`, einfarbig (Marke `#000000`) | simple-icons 16.36.0 (npm) | CC0 1.0 | 2026-10-30 |
| `zed.svg` | Zed (Zed Industries) | Simple Icons, `icons/zedindustries.svg`, Markenfarbe `#084CCF` (nicht verwendet, siehe unten) | simple-icons 16.36.0 (npm) | CC0 1.0 | 2026-10-30 |
| `opencode.svg` | OpenCode | Simple Icons, `icons/opencode.svg`, einfarbig (Marke `#000000`) | simple-icons 16.36.0 (npm) | CC0 1.0 | 2026-10-30 |
| `warp.svg` | Warp | Simple Icons, `icons/warp.svg`, Markenfarbe `#01A4FF` (nicht verwendet, siehe unten) | simple-icons 16.36.0 (npm) | CC0 1.0 | 2026-10-30 |
| `github.svg` | GitHub (GitHub, Inc.; Anmeldung, Sicherung, Abgleich, Klonen) | Simple Icons, `icons/github.svg` (Marke: https://github.com/logos), einfarbig in der Textfarbe | simple-icons 16.36.0 (npm) | CC0 1.0 | 2026-10-30 |
| (keine Datei) | Codex (OpenAI) | siehe unten | - | - | 2026-10-30 |

Alle Dateien (auch `github.svg`) sind unverändert aus dem Paket `simple-icons@16.36.0` übernommen (`npm pack`, entpackt in einen leeren Ordner, nur gelesen, nichts ausgeführt); nur der Dateiname ist kürzer (`googlegemini` → `gemini`, `githubcopilot` → `copilot`, `zedindustries` → `zed`). Der Lizenztext steht in `LIZENZ-simple-icons-CC0.md`. CC0 gilt für die SVG-Daten des Projekts Simple Icons; die Markenrechte bleiben bei den Inhabern.

## Darstellung: einheitliche Größe und Farbe

**Größe.** Simple Icons füllt bei jedem Zeichen die ganze 24×24-Fläche, ein dichtes Zeichen (Warp, OpenCode: gut die Hälfte der Fläche ist Tinte) wirkt dadurch viel größer als ein luftiges (Gemini: ein Fünftel). Damit alle gleich schwer aussehen, hat jedes Logo eine eigene **Ansicht** (`viewBox`), die um die Mitte der Glyphe liegt: Die Füllung des Quadrats beträgt `0,82 · (0,40 / Tintendichte)^0,25`, begrenzt auf 0,70 bis 0,96. Das ergibt etwa 0,96 für Gemini, 0,87 für Copilot, 0,82 für Claude, 0,79 für Cursor, 0,80 für Zed, 0,75 für OpenCode und 0,73 für Warp. Die Tintendichte wurde mit Chromium gemessen (Fläche der Glyphe in einem 240×240-Raster). Der Pfad bleibt Zeichen für Zeichen derselbe, nichts wird verzerrt oder verschoben: In den Dateien steht weiter `viewBox="0 0 24 24"`; die App (`KILogoQuelle.daten`) und das Studio (`ki-logos.js`) setzen für die Darstellung nur das Attribut `viewBox` neu. Die Zahlen stehen an beiden Orten und ein Test vergleicht sie.

| Logo | Ansicht (`x y breite höhe`) |
|---|---|
| Claude (Code, Desktop) | `-2.61 -2.61 29.21 29.21` |
| Cursor | `-3.28 -3.28 30.55 30.55` |
| Gemini | `-0.52 -0.52 25.03 25.03` |
| GitHub Copilot | `-1.83 -1.83 27.66 27.66` |
| Zed | `-3.01 -3.01 30.03 30.03` |
| OpenCode | `-4.08 -4.08 32.16 32.16` |
| Warp | `-4.35 -4.35 32.7 32.7` |

**Farbe.** Die Markenfarbe wird nur verwendet, wenn sie auf Weiß (Hellmodus) **und** auf dem dunklen Fenster (`#1E1E1E`, Dunkelmodus) mindestens **3:1** Kontrast hat (WCAG für Grafiken). Gemessen:

| Marke | Kontrast auf `#FFFFFF` | Kontrast auf `#1E1E1E` | Darstellung |
|---|---|---|---|
| Claude `#D97757` | 3,12 | 5,34 | Markenfarbe |
| Gemini `#8E75B2` | 3,93 | 4,24 | Markenfarbe |
| Zed `#084CCF` | 7,13 | 2,34 | einfarbig (zu dunkel im Dunkelmodus) |
| Warp `#01A4FF` | 2,71 | 6,16 | einfarbig (zu hell im Hellmodus) |
| Cursor, GitHub Copilot, OpenCode (Marke schwarz) | 21 | 1,26 | einfarbig (schwarz wäre im Dunkelmodus unsichtbar) |

„Einfarbig“ heißt `currentColor`: die Textfarbe der Umgebung (SwiftUI `Color.primary`, Studio `var(--text)`), also dunkel auf hell und hell auf dunkel. Der Test `markenfarbeNurBeiAusreichendemKontrastAufHellUndDunkel` hält die Regel fest.

## Codex: bewusst ohne Logo

Simple Icons enthält in Version 16.36.0 kein OpenAI- oder Codex-Logo (nur „OpenAI Gym“, ein anderes Produkt; geprüft am 2026-10-30 erneut). Die Marken-Seite von OpenAI (`openai.com/brand`) war auch am 2026-10-30 für den Abruf gesperrt (HTTP 403); nach den zugänglichen Zusammenfassungen verlangt OpenAI eine Genehmigung bzw. die Einhaltung der Richtlinien, keine Andeutung einer Partnerschaft oder Empfehlung, das Logo nicht prominenter als das eigene Zeichen, und Anfragen gehen an partnercomms@openai.com. Eine ausdrückliche Erlaubnis, das Logo zur Kennzeichnung einer Integration zu verwenden, und eine offizielle SVG-Quelle ließen sich nicht belegen. Deshalb zeigt Kortex für Codex nur die Initiale „C“ in einem neutralen Kreis. Wer die offizielle Freigabe einholt oder die Brand-Seite im Browser prüft, kann `codex.svg` hier ablegen und in `Sources/BrainCore/KILogoQuelle.swift` sowie `Ressourcen/studio/ki-logos.js` eintragen.

## Programme ohne Logo in Simple Icons

Kiro, Goose, Roo Code, Google Antigravity und VS Code haben in Simple Icons 16.36.0 kein Logo und gehören (aus anderen Gründen, siehe `docs/plaene/ki-programme.md`) auch nicht zu den angebundenen Programmen. Käme eines dazu, bekäme es die Initiale in einem neutralen Kreis, nie ein nachgezeichnetes oder aus anderen Quellen kopiertes Logo.

## Aktualisieren

Neue Version von `simple-icons` mit `npm pack` in einen neuen leeren Ordner holen, nur die Dateien dieser Tabelle vergleichen und hier ersetzen, Version und Datum in der Tabelle anpassen. Wenn sich ein Pfad ändert: Tintendichte und Ansicht neu messen, die Tabelle oben, `KILogoQuelle.swift` und `ki-logos.js` angleichen (der Test `ansichtenGleichenDenenImStudio` meldet Abweichungen).

## Wo die Logos eingebaut sind

- Studio (Web-Oberfläche): `Ressourcen/studio/ki-logos.js` (Claude, Cursor, Gemini, GitHub Copilot, Zed, OpenCode, Warp) und `Ressourcen/studio/marken.js` (GitHub). Die Pfaddaten stehen dort unverändert aus den SVG-Dateien; ein Test (`Tests/BrainCoreTests/MarkenLogoTests.swift`) prüft, dass `marken.js` und `github.svg` übereinstimmen, `KiZielTests` dasselbe für `ki-logos.js`.
- App (SwiftUI): `Sources/BrainCore/KILogoQuelle.swift` und `Sources/BrainApp/KILogo.swift` für die KI-Apps, `Sources/BrainCore/MarkenLogo.swift` (Zuordnung Marke zu Datei) und `Sources/BrainApp/MarkenLogoAnsicht.swift` für GitHub im Einrichtungsassistenten.
