# Herkunft der KI-Logos

Die Logos dienen nur dazu, KI-Apps zu kennzeichnen, mit denen Kortex sich verbindet.

**Marken gehören den jeweiligen Inhabern, Nutzung nur zur Kennzeichnung der Integration.** Kortex ist weder mit Anthropic, OpenAI noch Anysphere (Cursor) verbunden und wird von ihnen nicht empfohlen oder unterstützt. Die Logos werden nicht verändert (keine Verzerrung, kein Umfärben der Form; dargestellt wird in der Markenfarbe oder einfarbig in der Textfarbe).

| Datei | KI-App | Quelle | Version | Lizenz der SVG-Daten | Abgerufen |
|---|---|---|---|---|---|
| `claude.svg` | Claude (Claude Code, Anthropic) | Simple Icons, `icons/claude.svg` (Marke: https://claude.ai), Markenfarbe `#D97757` | simple-icons 16.36.0 (npm) | CC0 1.0 | 2026-10-29 |
| `cursor.svg` | Cursor (Anysphere) | Simple Icons, `icons/cursor.svg` (Marke: https://cursor.com/brand), einfarbig | simple-icons 16.36.0 (npm) | CC0 1.0 | 2026-10-29 |
| (keine Datei) | Codex (OpenAI) | siehe unten | - | - | 2026-10-29 |

Beide Dateien sind unverändert aus dem Paket `simple-icons@16.36.0` übernommen (`npm pack`, entpackt in einen leeren Ordner, nur gelesen, nichts ausgeführt). Der Lizenztext steht in `LIZENZ-simple-icons-CC0.md`. CC0 gilt für die SVG-Daten des Projekts Simple Icons; die Markenrechte bleiben bei den Inhabern.

## Codex: bewusst ohne Logo

Simple Icons enthält in Version 16.36.0 kein OpenAI- oder Codex-Logo (nur „OpenAI Gym“, ein anderes Produkt). Die Marken-Seite von OpenAI (`openai.com/brand`) war für den Abruf gesperrt (HTTP 403); nach den zugänglichen Zusammenfassungen verlangt OpenAI, das Logo nur unverändert und nur dort zu zeigen, wo es sich direkt auf OpenAI-Dienste bezieht, und es nicht so zu nutzen, dass eine Partnerschaft oder Empfehlung entsteht. Eine ausdrückliche Erlaubnis, das Logo zur Kennzeichnung einer Integration zu verwenden, und eine offizielle SVG-Quelle ließen sich nicht belegen. Deshalb zeigt Kortex für Codex nur die Initiale „C“ in einem neutralen Kreis. Wer die offizielle Freigabe einholt oder die Brand-Seite im Browser prüft, kann `codex.svg` hier ablegen und in `Sources/BrainCore/KILogoQuelle.swift` sowie `Ressourcen/studio/ki-logos.js` eintragen.

## Aktualisieren

Neue Version von `simple-icons` mit `npm pack` in einen neuen leeren Ordner holen, nur die zwei SVG-Dateien vergleichen und hier ersetzen, Version und Datum in der Tabelle anpassen.
