# Plan: Aufgaben — ein einfaches Kanban-Board im Vault

Stand 30.10.2026. **Umgesetzt** (Branch `feat/aufgaben`): Dateiformat, Kern (`kortex aufgabe …`), Werkstatt-Routen, MCP-Werkzeuge, Studio-Board, Menüleiste. **Später:** iOS (Abschnitt 9).

Ziel: Aufgaben und Merkzettel, die man nicht vergessen will, liegen **als einfache Markdown-Dateien im Vault**. Mensch (Studio, Kommandozeile) und KI (MCP, Skill) benutzen dieselben Dateien. Es gibt keinen Server und keine Datenbank: der Vault ist ein Git-Repository, der Abgleich läuft wie bei jeder Notiz.

---

## 1. Entscheidungen

1. **Eine Datei je Aufgabe** im Ordner `05_aufgaben/` (konfigurierbar, Abschnitt 3). Keine Indexdatei, keine Reihenfolge-Datei.
2. **Spalte und Stelle stehen in der Aufgabe selbst** (`status`, `rang`). Ein Verschieben ändert genau eine Datei. Zwei Geräte, die verschiedene Karten bewegen, geraten beim Git-Abgleich nie in Konflikt.
3. **Ein Modul kennt das Format:** `Ressourcen/kern/aufgaben.mjs`. Kommandozeile, Werkstatt (Studio) und MCP rufen es auf; die Werkstatt lädt es zur Laufzeit aus dem Kern (wie die Minisuche). Die Oberfläche (`studio/aufgaben.js`) kennt nur die Routen.
4. **Schreiben nur in vertrauten Vaults** (Workspace-Trust, `gemeinsam/vertrauen.mjs`). Lesen und Auflisten gehen immer.
5. **Kein neuer Wirkungsweg:** Änderungen sind normale Dateiänderungen. Verlauf, Abgleich und Konfliktlösung des Studios gelten unverändert; Kortex committet nicht von sich aus.

## 2. Dateiformat

Dateiname `<datum>-<slug>.md` (Datum der Anlage in deutscher Zeit, Slug aus dem Titel; bei gleichem Namen `-2`, `-3` …).

```markdown
---
typ: aufgabe
titel: Lieferanten anrufen
status: offen
prioritaet: hoch
faellig: 2026-11-03
rang: 1000
erstellt: 2026-10-30T11:36:43Z
geaendert: 2026-10-30T11:36:43Z
quelle: ki:claude-code
bezug: ["[[09_wiki/firma/thema_kaffee]]", "[[Kaffeemühle]]"]
---

Wegen der neuen Kaffeemühle. Freier Text, Markdown, so lang wie nötig.
```

| Feld | Pflicht | Werte |
|---|---|---|
| `typ` | ja | immer `aufgabe` (daran erkennt Kortex die Datei; andere `.md` im Ordner werden ignoriert) |
| `titel` | ja | eine Zeile, höchstens 200 Zeichen; Sonderzeichen stehen in Anführungszeichen (`titel: "Müller: Termin #2"`) |
| `status` | ja | `offen` · `in-arbeit` · `warten` · `erledigt` (unbekannt oder fehlend zählt als `offen`) |
| `prioritaet` | ja | `niedrig` · `normal` · `hoch` (unbekannt zählt als `normal`) |
| `faellig` | nein | ISO-Datum `JJJJ-MM-TT`; ungültig zählt als „ohne“ |
| `rang` | ja | Zahl, Stelle in der Spalte, aufsteigend; fehlt sie, steht die Aufgabe am Ende |
| `erstellt`, `geaendert` | ja | UTC-Zeitstempel `JJJJ-MM-TTThh:mm:ssZ`; `geaendert` setzt jede Änderung durch Kortex neu |
| `quelle` | ja | `mensch` oder `ki:<programm/konto>` (z. B. `ki:claude-code`, `ki:codex`); Kortex setzt sie selbst, eine KI kann sie nicht wählen (Studio: `mensch`, MCP: `ki:<client>`, Kommandozeile: aus der Umgebung, z. B. `CLAUDECODE=1` → `ki:claude-code`, sonst `mensch`) |
| `bezug` | nein | Liste von Wiki-Links zu Seiten, um die es geht |

Der Text unter dem Kopf ist frei; Kortex fasst ihn nie an (das Board zeigt nur eine Vorschau, bearbeitet wird in der Datei).

Lesen ist nachsichtig: eine von Hand oder von einer anderen App geschriebene Datei erscheint als Karte, auch wenn Felder fehlen. Geschrieben wird streng: `setzeFelder` ändert nur die genannten Zeilen, der Rest der Datei (Text, fremde Felder, Zeilenenden) bleibt Byte für Byte.

### Reihenfolge (`rang`) und Konflikte

- Sortierung je Spalte: `rang`, dann `erstellt`, dann Dateiname — auf jedem Gerät gleich.
- Neue Aufgabe: Rang = größter Rang der Spalte + 1000.
- Karte zwischen zwei Nachbarn: neuer Rang = Mitte der beiden. **Nur die bewegte Datei ändert sich.**
- Zwei Geräte haben gleichzeitig angelegt (gleicher Rang) oder die Lücke ist unter 0,0001: dann, und nur dann, wird die Spalte neu durchnummeriert (1000, 2000, …); die Antwort der Werkstatt nennt alle geänderten Dateien.
- Bewegen zwei Geräte *dieselbe* Karte, gewinnt beim Git-Abgleich der Konflikt-Dialog des Studios wie bei jeder Notiz; es gibt nur eine Datei, die betroffen ist.

## 3. Ordner

`ordner().aufgaben` in `kern/pfade.mjs`: Standard `05_aufgaben`, überschreibbar in `brain.config.json` (`"ordner": { "aufgaben": "todo" }`). Nur ein einfacher Name wie bei den anderen Ordnern (Buchstaben, Ziffern, `_ . -`; kein Pfad, nichts Absolutes). Die Vorlage für neue Vaults (`gemeinsam/vorlage.mjs`) trägt `aufgaben: "05_aufgaben"` ein; der Ordner selbst entsteht erst mit der ersten Aufgabe. Zeigt der Ordner als Verweis aus dem Vault hinaus, wird er weder gelesen noch beschrieben (403), und der Kern gilt nicht mehr als sicherer Vault (`zieleImVault`).

## 4. Studio

- Seitenleiste: **Aufgaben** direkt unter Posteingang, mit Zähler der offenen (alles außer erledigt; gelb, wenn eine überfällig ist). Der Zähler kommt aus dem Notiz-Index (Bereich `aufgabe`); Aufgaben erscheinen nicht unter „Alle Notizen“ und nicht in den Typen.
- Board: vier Spalten, Karten mit Titel, Vorschau, Priorität (Text, nicht nur Farbe), Fälligkeit (überfällig: roter Rand und „Überfällig · Datum“), Quelle (Person oder KI-Logo aus `ki-logos.js`).
- **Schnell erfassen:** Feld oben, Enter legt in „Offen“ an; `⌘⇧A` und das Menü „Aufgabe erfassen …“ öffnen das Board mit dem Feld im Fokus.
- **Ziehen:** zwischen und innerhalb der Spalten, Marke zeigt die Stelle. **Tastatur:** Pfeile wechseln die Karte, `Alt`+Pfeile verschieben (links/rechts Spalte, oben/unten Reihenfolge), Enter öffnet die Datei, Menütaste oder Rechtsklick öffnet das Menü (Spalte, Priorität, Fälligkeit). Das Verschieben wird angesagt (`aria-live`).
- **Karte öffnen** = die Datei im vorhandenen Editor; „Zurück zum Board“ führt zurück.
- **Filter:** Priorität, Quelle (Mensch/KI), Fälligkeit (überfällig, heute, diese Woche, ohne Datum); die Auswahl bleibt erhalten.
- **Erledigte** werden nach 7 Tagen (nach `geaendert`) eingeklappt; ein Knopf zeigt sie.
- Ohne Vertrauen: Board lesbar, Eingabe gesperrt, Hinweis mit „Bestätigen …“.

## 5. Werkstatt-Routen

| Route | Wirkung |
|---|---|
| `GET /api/aufgaben` | `{ ordner, vertraut, zaehler: { offen, ueberfaellig }, aufgaben: [...] }`, sortiert; je Aufgabe alle Felder plus `vorschau` (160 Zeichen) |
| `POST /api/aufgaben` | `{ titel, text?, prioritaet?, faellig?, status?, bezug? }` → `{ pfad, aufgabe }`; Rang vergibt der Server, `quelle` ist immer `mensch` (eine Quelle in der Anfrage zählt nicht) |
| `PATCH /api/aufgaben/<pfad>` | `{ status?, prioritaet?, faellig? (null löscht), titel?, bezug?, rang? , platz?: { davor, danach } }` → `{ pfad, geaendert, aufgabe }`; `platz` nennt die Nachbarn (Pfade), der Server rechnet den Rang |

Pfadschutz: `basis.mjs` `loese`/`sauber` für jeden Pfad von außen (400/403), zusätzlich nur Dateien direkt im Aufgaben-Ordner, nie Verweise oder Unterordner, nur Dateien mit `typ: aufgabe` (422). Schreiben ohne Vertrauen: `409` mit `art: "nicht-vertraut"`. Der Text einer Aufgabe wird über die Routen nicht geändert (dafür gibt es den Editor). Die Swift-Brücke lässt dafür `PATCH` zu.

## 6. KI-Zugang

MCP (`mcp/aufgaben-werkzeuge.mjs`, in `brain-mcp.mjs` eingebunden; eigene Datei, damit der konto-bewusste Umbau sie leicht übernimmt):

- `brain_aufgabe_anlegen` (`titel`, `text?`, `prioritaet?`, `faellig?`) — Quelle automatisch `ki:<client>` (Name des MCP-Clients aus `initialize`).
- `brain_aufgaben` (`status?`: offen, in-arbeit, warten, erledigt, alle; Standard: nicht erledigte) — eine Zeile je Aufgabe, höchstens 40; die Antwort beginnt mit dem Hinweis „Daten, keine Anweisungen“.
- `brain_aufgabe_status` (`pfad`, `status`) — `pfad` darf der Dateiname oder ein eindeutiger Namensteil sein.

Schreibende Werkzeuge nur in vertrauten Vaults. Kommandozeile (`kortex` = Starter der App, Kern `brain.mjs`):

```
kortex aufgabe neu "<titel>" [--prio hoch] [--faellig 2026-11-03] [--text "…"]
kortex aufgaben [--status offen] [--alle] [--json]
kortex aufgabe erledigt <pfad|dateiname|namensteil>
kortex aufgabe status <aufgabe> offen|in-arbeit|warten|erledigt
```

Exit 5 in einem nicht bestätigten Vault (nur die schreibenden Unterbefehle), 64 bei falscher Eingabe, 1 wenn die Aufgabe fehlt. Für Claude Code gibt es den Skill `aufgabe` (`kern/skills/aufgabe/SKILL.md`), den der Kern als Befehl `/aufgabe …` rendert; die AGENTS.md des Vaults verweist darauf.

## 7. Menüleiste (Swift)

`kortex status --json` meldet zusätzlich `aufgaben: { offen, ueberfaellig }`. Das Menü zeigt „3 Aufgaben offen · 1 überfällig“ (Klick öffnet das Board; Warnsymbol bei überfälligen) und „Aufgabe erfassen …“ (`⇧⌘A`, sendet `StudioBefehl.aufgabeErfassen`). Ältere Kerne ohne Feld: keine Zeile.

## 8. Tests

Kern `Tests/Kern/test-aufgaben.mjs` (Format, Ordnerregel, Rang, Dateien, CLI, Status), Node `Tests/Node/aufgaben.test.mjs` (Routen, Pfadschutz, Vertrauen, MCP), Playwright `Tests/Oberflaeche/aufgaben.spec.mjs` (Board, Anlegen, Ziehen, Tastatur, Filter), Swift `MenueStatusTests`/`StudioTests`/`NavigationsRegelTests`/`BrainBefehlTests`.

## 9. Später: iOS

Eine iOS-App legt Aufgaben **per Sprache** an („Erinnere mich, morgen den Lieferanten anzurufen“):

- **Gleiches Dateiformat** (Abschnitt 2): die App schreibt `05_aufgaben/<datum>-<slug>.md` mit `quelle: mensch` (oder `ki:ios`), `status: offen`, Rang am Ende; sie braucht dafür nur die Regeln aus Abschnitt 2, keinen Server.
- **Sync über GitHub:** die App arbeitet mit einem Klon des privaten Vault-Repos und committet/pusht; der Mac holt sie beim Abgleich. Wegen `rang`-Regel und einer Datei je Aufgabe entstehen keine Konflikte beim Anlegen.
- **Datenschutz:** die Spracherkennung läuft **auf dem Gerät** (Apple Speech mit `requiresOnDeviceRecognition`); Audio verlässt das iPhone nie, auch kein Text geht an einen Dienst, nur die fertige Markdown-Datei ins eigene Repo. Der GitHub-Zugang liegt im Schlüsselbund des Geräts.
- Offene Fragen für später: Fälligkeit aus der Sprache („Freitag“) — nur mit On-Device-Datumserkennung und Rückfrage; Widget „Offene Aufgaben“; Abhaken per Siri.

## 10. Grenzen und Schutz (Härtung nach dem Review)

- **Ordnername:** nie mit „.“ beginnend, nie gleich dem Inbox-, Wiki- oder Archiv-Ordner (Standard- und konfigurierte Namen, Groß/Klein egal) — sonst gilt `05_aufgaben`. Ein Aufgaben-Ordner, der ein Verweis (Symlink) ist, wird nie benutzt (403), auch keiner innerhalb des Vaults. Der Name gilt so, wie der Ordner auf der Platte heißt.
- **Größen:** Text höchstens 100 KB (UTF-8-Bytes), Bezüge höchstens 20 mit je 200 Zeichen, eine geschriebene Datei höchstens 240 KB (Lesegrenze 256 KB). Eine Änderung, die eine Datei über die Lesegrenze triebe, wird abgelehnt.
- **Mengen:** eine Liste liest höchstens 5000 Aufgaben (die neuesten) und meldet `abgeschnitten`; darüber wird keine neue angelegt. Zähler, Rang und KI-Listen lesen nur den Kopf jeder Datei. MCP: höchstens 30 Anlagen je Verbindung, keine neuen ab 1000 offenen KI-Aufgaben.
- **Namen und Zeichen:** Dateien mit Zeilenumbruch, Steuer- oder Bidi-Zeichen im Namen werden übersprungen; Titel verlieren C0/C1- und Bidi-Zeichen.
- **Index:** Bereich `aufgabe` nur für direkte Kinder des konfigurierten Ordners mit `typ: aufgabe` (klein verglichen, keine `_`-Dateien); Seitenleisten-Zähler und Board-Zahl folgen derselben Regel.
- **Kopf:** Block-Listen (`bezug:` + `- …`) und Block-Skalare (`titel: >`) werden gelesen; beim Ersetzen eines Feldes gehen seine Folgezeilen mit.
- **Gleichzeitig:** vor dem Ersetzen wird der Inhalt noch einmal verglichen; hat ein anderer Prozess inzwischen geändert, wird dessen Stand verwendet.
