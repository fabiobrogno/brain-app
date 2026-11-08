# Runde 3: Funktionslücken im Editor

Stand: 07.11.2026 · gemeinsamer Plan der vier parallelen Pakete. Jede Seite gehört dem Paket, das sie schreibt; Fremdes nur ergänzen, nicht umschreiben.

## Hintergrund

Die Funktionsprüfung (Vergleich mit Obsidian, Bear, Craft) zeigt Lücken, die Nutzer dort als selbstverständlich erwarten: Bilder und Anhänge,
Tabellen, Fett/Kursiv per Tastatur, eingefügtes HTML als Markdown, Tags mit Ansicht, Export und Teilen, unverlinkte Erwähnungen und eine
Übersicht „Was ist neu“. Runde 3 schließt diese Lücken in vier Paketen, die unabhängig voneinander gebaut und gemergt werden.

| Paket | Inhalt | Eigene Module (Ziel: wenig Streuung in `editor.js`) |
|---|---|---|
| 3a | Bilder und Anhänge | `gemeinsam/anhaenge.mjs`, `werkstatt/anhaenge.mjs`, `studio/editor-anhaenge.js`, `studio/anhaenge.js` |
| 3b | Tabellen, ⌘B/⌘I, HTML beim Einfügen als Markdown | eigene Editor-Module |
| 3c | Tags (Ansicht, Umbenennen), Export, Teilen | eigene Module |
| 3d | Unverlinkte Erwähnungen, Karte „Was ist neu“ | eigene Module |

Alle vier berühren `editor.js` (Erweiterungsliste in `erstelleEditor`). Regel: je Paket eine einzeilige Einhängung dort, die Logik liegt im
eigenen Modul. Wer später merged, holt `origin/main` und löst nur diese Zeilen auf.

## Später: KI-Vorschläge (nicht in Runde 3)

Zwei Ideen, die auf Runde 3 aufbauen, aber noch nicht gebaut werden:

- **Vorschlagskarten im Posteingang:** die KI schlägt vor (Tags, Verknüpfungen, Zusammenfassung, Ablageort), der Nutzer übernimmt oder verwirft.
- **Editor-Aktionen als Diff:** „Kürzen“, „Gliedern“, „Korrigieren“ zeigen das Ergebnis als Unterschied zum Text; erst „Übernehmen“ schreibt.

Grundsatz: **Die KI handelt nie, sie schlägt nur vor.** Jede Wirkung geht über eine sichtbare Bestätigung des Nutzers, jede Änderung ist rückgängig
(Fassungen, Papierkorb). Risiko **Prompt-Injection aus Notizinhalt:** Text einer Notiz (auch aus dem Web eingefügt, aus Anhängen oder PDFs) kann
Anweisungen an die KI enthalten. Darum gilt: Notiztext ist Daten, nie Anweisung; Vorschläge sind reiner Text/Diff ohne Aufrufe von Werkzeugen mit
Wirkung; Links und Bilder in KI-Antworten werden nie von außen geladen (das tut schon `frage-markdown.js`, und Paket 3a erweitert es nur um lokale Bilder).

---

## 3a: Bilder und Anhänge

### Ziel
Bilder und Dateien lassen sich in eine Notiz einfügen (Zwischenablage, Ziehen aus Finder/Explorer, Ziehen aus dem Browser), erscheinen im Editor
und in „Frag deinen Vault“ als Bild bzw. als Chip und überstehen Umbenennen, Verschieben und Löschen.

### Entscheidungen
- **Format: `![[datei.png]]`** (Obsidian-kompatibel; Wikilink-Einbettung). Der Name ist im Vault eindeutig, deshalb löst Kortex ihn über den Dateinamen auf
  (zuerst Ordner der Notiz, dann Anhänge-Ordner, dann überall im Vault), und Verschieben einer Notiz bricht nichts. Weiter gelesen werden
  `![Alt](relativer/pfad.png)` und `![[ordner/datei.png]]` (die Link-Pflege schreibt sie beim Umbenennen/Verschieben schon um).
- **Ablage:** Einstellung „Anhänge-Ordner“ (`anhaengeOrt`): `vault` (Standard, `_anhaenge/` an der Wurzel des Vaults) oder `notiz`
  (`_anhaenge/` im Ordner der Notiz). Der Ordnername ist einstellbar (`anhaengeOrdner`).
- **Namen:** `JJJJ-MM-TT-HHMMSS-<slug>.<endung>`; der Slug kommt aus dem Namen der Datei (bei Einfügen aus der Zwischenablage „bild“), die Endung aus dem
  geprüften Typ, nicht aus dem Namen. Belegt = Zähler `-2`; geschrieben wird exklusiv (`wx`), nie überschrieben.
- **Grenzen:** größte Größe einstellbar (Standard 20 MB, höchstens 100 MB); Hinweis mit Größe. Erlaubte Typen für die Anzeige im Text: png, jpg, gif, webp,
  svg; weitere harmlose Dokumente (pdf, office, txt, csv, zip, Audio/Video) nur als Chip. Ausführbares und aktive Inhalte (html, js, exe, app, sh, bat …) werden abgelehnt.
  Der Typ wird am Inhalt geprüft (Kennung der Bytes), nicht am Namen.
- **SVG:** wird beim Speichern bereinigt (keine Skripte, kein `foreignObject`, keine `on…`-Attribute, keine Adressen nach außen) und im Editor nur als `<img>` gezeigt;
  die Werkstatt liefert Anhänge mit `Content-Security-Policy: sandbox`.
- **Externe Bilder** (`![](https://…)`): nie geladen, außer die Einstellung „Externe Bilder laden“ (Standard aus) ist an oder der Nutzer klickt auf den Platzhalter
  (nur dieses Bild, nur diese Sitzung). Geladen wird über die Werkstatt (`/_extern-bild`): nur https, keine privaten Adressen, Größe und Typ begrenzt;
  die Seite bleibt bei `img-src 'self'`.
- **Löschen einer Notiz:** gibt es Anhänge, die nur diese Notiz benutzt, fragt Kortex, was damit geschehen soll (mit löschen = Papierkorb, behalten). Nie direkt löschen.
- **Hülle:** neue Aktion `anhang-oeffnen` im Vertrag (System-App öffnet PDF/Dokument). Dateien aus der Zwischenablage und per Ziehen kommen als DOM-Ereignis
  (`File`); das Studio schickt sie in Stücken über die Werkstatt (der Nachrichtenkanal der Mac-App ist auf 8 MB je Anfrage begrenzt).

### Prüfkriterien (fertig, wenn)
1. Node-Tests grün: Speichern (Pfad, Ort, Ordner), Namen (Slug, Zähler, keine Überschreibung), Typprüfung und Größe, SVG-Bereinigung, Auflösen, Umbenennen/Verschieben,
   unbenutzte Anhänge beim Löschen, externe Bilder (SSRF-Schranken).
2. Playwright grün: Einfügen und Ziehen eines Bildes und einer PDF, Anzeige im Editor, Lightbox, externes Bild mit Platzhalter, hell und dunkel; Bilder im Scratchpad.
3. Hüllen-Vertrag (JSON, Swift, Electron, Browser) nennt `anhang-oeffnen`; die Tests dazu sind grün.
4. `ci-ok` einschließlich Linux- und Windows-Bahnen grün.

### Risiken
- **Mac-App (WKWebView):** Einfügen von Bildern und Ziehen aus dem Finder liefert normalerweise `File`-Objekte; das ist hier nur im Browser/Chromium geprüft, nicht im echten
  Fenster. Ein Dateiwähler (`<input type=file>`) geht in WKWebView erst mit einem `WKUIDelegate`; das gibt es in der App heute nicht. Darum: kein Dateiwähler in 3a, ehrlicher Hinweis, wenn das Einfügen nichts liefert.
- **Eindeutigkeit der Namen** gilt nur für Dateien, die Kortex anlegt; selbst abgelegte gleichnamige Dateien löst die feste Suchreihenfolge auf.
- **Speicher beim Hochladen** (Stücke liegen bis zum Ende im Speicher der Werkstatt): Obergrenze = Größengrenze, Sitzungen verfallen nach 2 Minuten.
- **Mehrere Fenster/Geräte:** Anhänge sind normale Dateien im Vault und laufen mit Git und Abgleich; große Bilder blähen das Repo auf (Hinweis ab 5 MB).

---

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

## 3c: Tags und Export/Teilen

### Ziel
Tags (`#tag`, Frontmatter) haben eine Ansicht, lassen sich umbenennen und filtern; eine Notiz lässt sich als Markdown, PDF oder HTML exportieren und teilen.
### Prüfkriterien
Tag-Umbenennen ändert alle Notizen atomar mit Vorschau; Export enthält eingebettete Bilder (nutzt die Auflösung aus 3a) und gibt nichts Fremdes weiter.
### Risiken
Export von Bildern und Anhängen hängt an der Auflösung von 3a (`gemeinsam/anhaenge.mjs`); Teilen darf nichts ohne Zustimmung nach außen senden.

## 3d: Unverlinkte Erwähnungen und „Was ist neu“

### Ziel
Eine Notiz zeigt, wo ihr Titel in anderen Notizen vorkommt, ohne verlinkt zu sein (Übernehmen = Link setzen), und eine Karte „Was ist neu“ fasst
Änderungen seit dem letzten Besuch zusammen.
### Prüfkriterien
Erwähnungen ohne Treffer in Code, Links und Kopf; Übernehmen ändert genau eine Stelle (rückgängig); die Karte zeigt nur, was wirklich geändert wurde.
### Risiken
Rechenzeit in großen Vaults (Index, Grenzen); Fehltreffer bei kurzen Titeln.
