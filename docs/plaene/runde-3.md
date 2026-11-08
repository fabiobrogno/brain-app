# Runde 3

Plan der Runde 3 (Schreiben im Editor). Jedes Paket hat seinen Abschnitt; die technischen Einzelheiten stehen in `docs/ENTWICKLUNG.md`.

## 3b – Tabellen, Formatierung, Einfügen

**Ziel:** Tabellen wie in Notion bearbeiten, Text mit Kürzeln und einer kleinen Leiste formatieren, Fremdes (Web, Word, Notion) sauber als Markdown einfügen. Die Datei bleibt immer gewöhnliches Markdown.

| Teil | Ergebnis |
|---|---|
| Tabellen | Anzeige als Tabelle (Live-Vorschau), Zellen direkt bearbeiten, Tab/⇧Tab/Enter, Ausrichtung der Spalten beim Schreiben, Kontextmenü (Zeile/Spalte einfügen/löschen, Ausrichtung), Befehl „Tabelle einfügen“ (Palette, ⌥⇧⌘T); Rohtext-Modus bleibt |
| Formatierung | ⌘B, ⌘I, ⇧⌘C (Code), ⇧⌘X, Link ⌘L, Überschriften ⌥⇧⌘1–4, Listen ⇧⌘8/7/9, alle im Kürzel-Register (änderbar, Konfliktprüfung) |
| Einfügen | HTML → Markdown (Überschriften, Listen, Tabellen, Links, fett/kursiv, Code), ⇧⌘V als reiner Text, Adresse über Auswahl = Link, Bild-Hook für die Anhänge aus 3a |
| Format-Leiste | kleine Leiste über markiertem Text, abschaltbar (Einstellungen → Darstellung) |

**Entscheidungen bei Konflikten im Kürzel-Register:** ⌘E ist „Kortex einrichten“ → Code liegt auf ⇧⌘C. ⌘K ist die Palette und ⇧⌘K löscht die Zeile (CodeMirror) → Link auf ⌘L. ⌥⌘1/⌥⌘2 sind „Studio öffnen“/„Übersicht öffnen“ → Überschriften auf ⌥⇧⌘1–4. ⌘1–4 sind „Gehe zu“.

**Offen / Übergabe:** Bilder aus der Zwischenablage legt erst die Anhang-Logik aus 3a ab (`ctx.bildEinfuegen`); ein Schrägstrich-Menü gibt es noch nicht (der Befehl „Tabelle einfügen“ steht in der Palette).
